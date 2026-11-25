"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it } = require("node:test");

const {
  resolveEnvironmentTarget,
  normalizeEnvironment,
} = require("../lib/backup-env");
const {
  defaultExportTables,
  assertExportScope,
  TABLE_CLASSIFICATION,
} = require("../lib/backup-table-scope");
const {
  encryptPayload,
  decryptPayload,
  decodeEncryptionKey,
} = require("../lib/backup-crypto");
const {
  buildEncryptedArtifact,
  parseArtifactBuffer,
  decryptArtifact,
} = require("../lib/backup-artifact");
const { validateManifest, buildManifest } = require("../lib/backup-manifest");
const {
  workdriveConfigFromEnv,
  resolveFolderId,
  normalizeFrequency,
  uploadEncryptedArtifact,
  DUPLICATE_STATUS,
} = require("../lib/backup-workdrive");
const {
  createSecureTempDir,
  secureDeletePath,
  verifyEncryptedArtifact,
  runRecoveryVerification,
} = require("../lib/backup-recovery");
const { sortRowsDeterministic } = require("../lib/backup-export");
const { parseBackupCliArgs } = require("../lib/backup-pipeline");

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function writeMockCatalystRc(activeEnvName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baylen-rc-"));
  const rc = {
    actives: { project: 1, env: 1 },
    projects: [
      {
        idx: 1,
        id: "36851000000230006",
        name: "Baylen-App",
        env: [
          { idx: 1, id: "60069781151", name: "Development" },
          { idx: 2, id: "99999999999", name: "Production" },
        ],
      },
    ],
  };
  const active = rc.projects[0].env.find((item) => item.name === activeEnvName);
  rc.actives.env = active ? active.idx : 1;
  const file = path.join(dir, ".catalystrc");
  fs.writeFileSync(file, JSON.stringify(rc), "utf8");
  return file;
}

function sampleSnapshot(environment) {
  const tables = {
    Warehouses: [{ ROWID: 2, code: "WH-B" }, { ROWID: 1, code: "WH-A" }],
    Inventory: [{ ROWID: 1, warehouse_id: 1, quantity_on_hand: 10 }],
  };
  return {
    export_metadata: {
      exported_at: "2026-09-03T10:00:00.000Z",
      environment,
      project_id: "36851000000230006",
      schema_version: "baylen-backup-schema-v1",
      table_order: Object.keys(tables),
    },
    tables,
    row_counts: { Warehouses: 2, Inventory: 1 },
  };
}

describe("backup env targeting", () => {
  it("requires mandatory --env", () => {
    assert.throws(
      () => parseBackupCliArgs(["node", "script"]),
      (error) => error.code === "ENV_REQUIRED"
    );
    assert.throws(
      () => resolveEnvironmentTarget({ env: "" }),
      (error) => error.code === "ENV_REQUIRED"
    );
  });

  it("accepts valid Development", () => {
    const rc = writeMockCatalystRc("Development");
    const resolved = resolveEnvironmentTarget({
      env: "Development",
      catalystRcPath: rc,
    });
    assert.equal(resolved.environment, "Development");
    assert.equal(resolved.projectId, "36851000000230006");
  });

  it("rejects invalid environment values", () => {
    assert.throws(
      () =>
        resolveEnvironmentTarget({
          env: "Staging",
          catalystRcPath: writeMockCatalystRc("Development"),
        }),
      /Invalid environment/
    );
  });

  it("wrong-environment guard rejects Production when not provisioned", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baylen-rc-prod-"));
    const rc = {
      actives: { project: 1, env: 1 },
      projects: [
        {
          idx: 1,
          id: "36851000000230006",
          name: "Baylen-App",
          env: [{ idx: 1, id: "60069781151", name: "Development" }],
        },
      ],
    };
    const file = path.join(dir, ".catalystrc");
    fs.writeFileSync(file, JSON.stringify(rc), "utf8");
    assert.throws(
      () =>
        resolveEnvironmentTarget({
          env: "Production",
          catalystRcPath: file,
        }),
      (error) => error.code === "ENV_NOT_PROVISIONED"
    );
  });
});

describe("backup catalyst target guard", () => {
  it("fails when CLI active environment differs from requested backup env", () => {
    const { initializeCatalystApp } = require("../lib/backup-catalyst");
    const rc = writeMockCatalystRc("Development");
    const resolved = resolveEnvironmentTarget({
      env: "Production",
      catalystRcPath: rc,
    });
    assert.throws(
      () => initializeCatalystApp(resolved),
      (error) => error.code === "ENV_TARGET_MISMATCH"
    );
  });
});

describe("backup table scope", () => {
  it("includes complete production-critical allowlist", () => {
    const tables = defaultExportTables();
    assertExportScope(tables);
    assert.ok(tables.includes("Orders"));
    assert.ok(tables.includes("Serviceable_Pincodes"));
    assert.ok(tables.includes("Beauty_Service_Zones"));
  });

  it("classifies known tiers", () => {
    assert.equal(TABLE_CLASSIFICATION.PRODUCTION_CRITICAL.includes("Users"), true);
    assert.equal(TABLE_CLASSIFICATION.OPTIONAL.includes("Search_Documents"), true);
  });
});

describe("backup export determinism", () => {
  it("sorts rows deterministically by ROWID", () => {
    const sorted = sortRowsDeterministic([
      { ROWID: 3, code: "c" },
      { ROWID: 1, code: "a" },
      { ROWID: 2, code: "b" },
    ]);
    assert.deepEqual(sorted.map((row) => row.ROWID), [1, 2, 3]);
  });
});

describe("backup encryption", () => {
  it("uses AES-256-GCM", () => {
    const plain = Buffer.from("secret payload");
    const encrypted = encryptPayload(plain, TEST_KEY_HEX);
    assert.equal(encrypted.iv.length, 12);
    assert.equal(encrypted.authTag.length, 16);
    const decrypted = decryptPayload(encrypted, TEST_KEY_HEX);
    assert.equal(decrypted.toString("utf8"), "secret payload");
  });

  it("generates random IV per backup", () => {
    const plain = Buffer.from("payload");
    const a = encryptPayload(plain, TEST_KEY_HEX);
    const b = encryptPayload(plain, TEST_KEY_HEX);
    assert.notEqual(a.iv.toString("hex"), b.iv.toString("hex"));
  });

  it("fails when encryption key missing", () => {
    assert.throws(
      () => decodeEncryptionKey(""),
      (error) => error.code === "BACKUP_KEY_MISSING"
    );
  });

  it("fails when encryption key invalid length", () => {
    assert.throws(
      () => decodeEncryptionKey("too-short"),
      (error) => error.code === "BACKUP_KEY_INVALID"
    );
  });

  it("detects tampered ciphertext", () => {
    const encrypted = encryptPayload(Buffer.from("payload"), TEST_KEY_HEX);
    encrypted.encrypted[0] ^= 0xff;
    assert.throws(() => decryptPayload(encrypted, TEST_KEY_HEX));
  });

  it("detects tampered auth tag", () => {
    const encrypted = encryptPayload(Buffer.from("payload"), TEST_KEY_HEX);
    encrypted.authTag[0] ^= 0xff;
    assert.throws(() => decryptPayload(encrypted, TEST_KEY_HEX));
  });

  it("decrypts successful artifact", async () => {
    const snapshot = sampleSnapshot("Development");
    const built = buildEncryptedArtifact({
      snapshot,
      backupId: crypto.randomUUID(),
      projectId: "36851000000230006",
      environment: "Development",
      frequency: "daily",
      encryptionKey: TEST_KEY_HEX,
    });
    const verify = await verifyEncryptedArtifact({
      artifactBuffer: built.artifactBuffer,
      encryptionKey: TEST_KEY_HEX,
      expectedEnvironment: "Development",
      expectedProjectId: "36851000000230006",
    });
    assert.equal(verify.ok, true);
    assert.equal(verify.totalRows, 3);
  });
});

describe("plaintext protection", () => {
  it("cleans temporary directories", () => {
    const dir = createSecureTempDir();
    const file = path.join(dir, "tmp.json");
    fs.writeFileSync(file, "{}", "utf8");
    const cleanup = secureDeletePath(dir);
    assert.equal(cleanup.deleted, true);
    assert.equal(cleanup.verified, true);
  });
});

describe("workdrive destination selection", () => {
  it("defaults connection link name to zohodrive", () => {
    const config = workdriveConfigFromEnv({});
    assert.equal(config.connectionName, "zohodrive");
  });

  const config = workdriveConfigFromEnv({
    BACKUP_WORKDRIVE_DAILY_FOLDER_ID: "daily-id",
    BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID: "weekly-id",
    BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID: "monthly-id",
    BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID: "recovery-id",
    WORKDRIVE_CONNECTION_NAME: "zohodrive",
  });

  it("selects Daily folder", () => {
    assert.equal(resolveFolderId("daily", config), "daily-id");
  });
  it("selects Weekly folder", () => {
    assert.equal(resolveFolderId("weekly", config), "weekly-id");
  });
  it("selects Monthly folder", () => {
    assert.equal(resolveFolderId("monthly", config), "monthly-id");
  });
  it("selects Recovery-Test folder", () => {
    assert.equal(resolveFolderId("recovery-test", config), "recovery-id");
  });
  it("fails when folder id missing", () => {
    assert.throws(
      () => resolveFolderId("daily", workdriveConfigFromEnv({})),
      (error) => error.code === "WORKDRIVE_FOLDER_MISSING"
    );
  });
  it("fails when WorkDrive connection missing", async () => {
    const app = {
      connections: () => ({
        getConnectionCredentials: async () => {
          throw new Error("not configured");
        },
      }),
    };
    await assert.rejects(
      () =>
        uploadEncryptedArtifact({
          app,
          buffer: Buffer.from("x"),
          fileName: "test.baylen-backup",
          folderId: "daily-id",
          config,
        }),
      (error) => error.code === "WORKDRIVE_CONNECTION_MISSING"
    );
  });

  it("handles duplicate filename conflicts by surfacing error code", async () => {
    const app = {
      connections: () => ({
        getConnectionCredentials: async () => ({
          headers: { Authorization: "Zoho-oauthtoken test-token" },
        }),
      }),
    };
    await assert.rejects(
      () =>
        uploadEncryptedArtifact({
          app,
          buffer: Buffer.from("encrypted"),
          fileName: "dup.baylen-backup",
          folderId: "daily-id",
          config,
          fetchImpl: async () => ({
            ok: false,
            status: DUPLICATE_STATUS,
            json: async () => ({ error: "duplicate" }),
          }),
        }),
      (error) => error.code === "WORKDRIVE_DUPLICATE"
    );
  });
});

describe("manifest integrity", () => {
  it("validates required manifest fields", () => {
    const manifest = buildManifest({
      backupId: "id",
      projectId: "36851000000230006",
      environment: "Development",
      createdAt: new Date().toISOString(),
      frequency: "daily",
      includedTables: ["Inventory"],
      rowCounts: { Inventory: 1 },
      payloadSha256: "abc",
      encryptedArtifactSha256: "def",
    });
    assert.deepEqual(validateManifest(manifest), []);
  });
});

describe("recovery verification", () => {
  it("passes end-to-end verify without production mutation", async () => {
    const snapshot = sampleSnapshot("Development");
    const built = buildEncryptedArtifact({
      snapshot,
      backupId: crypto.randomUUID(),
      projectId: "36851000000230006",
      environment: "Development",
      frequency: "recovery-test",
      encryptionKey: TEST_KEY_HEX,
    });
    const result = await runRecoveryVerification({
      artifactBuffer: built.artifactBuffer,
      encryptionKey: TEST_KEY_HEX,
      expectedEnvironment: "Development",
      expectedProjectId: "36851000000230006",
    });
    assert.equal(result.ok, true);
    assert.equal(result.productionMutated, false);
  });

  it("detects tampered artifact envelope", async () => {
    const snapshot = sampleSnapshot("Development");
    const built = buildEncryptedArtifact({
      snapshot,
      backupId: crypto.randomUUID(),
      projectId: "36851000000230006",
      environment: "Development",
      frequency: "daily",
      encryptionKey: TEST_KEY_HEX,
    });
    const envelope = parseArtifactBuffer(built.artifactBuffer);
    envelope.encryptedPayload = envelope.encryptedPayload.slice(0, -4) + "AAAA";
    const tampered = Buffer.from(JSON.stringify(envelope), "utf8");
    const result = await verifyEncryptedArtifact({
      artifactBuffer: tampered,
      encryptionKey: TEST_KEY_HEX,
      expectedEnvironment: "Development",
      expectedProjectId: "36851000000230006",
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "decrypt");
  });
});

describe("backup export pagination", () => {
  it("uses paged reads without arbitrary LIMIT truncation", async () => {
    const { exportTableRows } = require("../lib/backup-export");
    const pages = [
      [{ ROWID: 1 }, { ROWID: 2 }],
      [{ ROWID: 3 }],
    ];
    let call = 0;
    const app = {
      datastore: () => ({
        table: () => ({
          getPagedRows: async () => {
            const data = pages[call] || [];
            const hasMore = call < pages.length - 1;
            call += 1;
            return {
              data,
              more_records: hasMore,
              next_token: hasMore ? "next" : undefined,
            };
          },
        }),
      }),
    };
    const rows = await exportTableRows(app, "Inventory");
    assert.equal(rows.length, 3);
    assert.equal(call, 2);
  });
});

describe("backup cli parsing", () => {
  it("parses full backup command", () => {
    const parsed = parseBackupCliArgs([
      "node",
      "script",
      "--env",
      "Development",
      "--mode",
      "full",
      "--frequency",
      "daily",
    ]);
    assert.equal(normalizeEnvironment(parsed.env), "Development");
    assert.equal(parsed.mode, "full");
    assert.equal(normalizeFrequency(parsed.frequency), "daily");
  });
});
