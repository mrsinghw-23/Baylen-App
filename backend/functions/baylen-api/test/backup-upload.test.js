"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { describe, it, beforeEach, afterEach } = require("node:test");

const { buildEncryptedArtifact } = require("../lib/backup-artifact");
const { DUPLICATE_STATUS } = require("../lib/backup-workdrive");
const {
  isPlaintextBackupArtifact,
  assertEncryptedArtifactBuffer,
  validateArtifactForUpload,
  uploadValidatedBackupArtifact,
  uniqueUploadFileName,
} = require("../lib/backup-upload");

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const FOLDER_IDS = {
  BACKUP_WORKDRIVE_DAILY_FOLDER_ID: "ran7hb08ff45f5ee540788a4fa8da84eaa208",
  BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID: "ran7ha2bc8446c09e4909ac8ba57c339e8678",
  BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID: "ran7h9f831d8f6bd147149451e12e1cd9e4b2",
  BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID: "ran7h03f9877c24f74c859a8602da9e6dd08c",
  WORKDRIVE_CONNECTION_NAME: "zohodrive",
  BACKUP_ENCRYPTION_KEY: TEST_KEY_HEX,
};

function sampleSnapshot(environment) {
  const tables = {
    Warehouses: [{ ROWID: 1, code: "WH-A" }],
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
    row_counts: { Warehouses: 1, Inventory: 1 },
  };
}

function buildSampleArtifact({ environment = "Development", frequency = "daily" } = {}) {
  return buildEncryptedArtifact({
    snapshot: sampleSnapshot(environment),
    backupId: crypto.randomUUID(),
    projectId: "36851000000230006",
    environment,
    frequency,
    encryptionKey: TEST_KEY_HEX,
  });
}

describe("backup upload validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, FOLDER_IDS);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses connection link name zohodrive from env", async () => {
    let requestedLink = "";
    const built = buildSampleArtifact();
    const app = {
      connections: () => ({
        getConnectionCredentials: async (linkName) => {
          requestedLink = linkName;
          return { headers: { Authorization: "Zoho-oauthtoken token" } };
        },
      }),
    };
    await uploadValidatedBackupArtifact({
      app,
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "daily",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ attributes: { resource_id: "wd-file-1" } }],
        }),
      }),
    });
    assert.equal(requestedLink, "zohodrive");
  });

  it("rejects plaintext table export JSON", () => {
    const plaintext = Buffer.from(
      JSON.stringify({
        export_metadata: { environment: "Development" },
        tables: { Users: [{ ROWID: 1 }] },
      }),
      "utf8"
    );
    assert.equal(isPlaintextBackupArtifact(plaintext), true);
    assert.throws(
      () => assertEncryptedArtifactBuffer(plaintext),
      (error) => error.code === "BACKUP_PLAINTEXT_REJECTED"
    );
  });

  it("rejects invalid artifact envelope", () => {
    assert.throws(
      () =>
        validateArtifactForUpload({
          artifactBuffer: Buffer.from("not-json", "utf8"),
          environment: "Development",
          frequency: "daily",
          encryptionKey: TEST_KEY_HEX,
        }),
      (error) => error.code === "BACKUP_ARTIFACT_INVALID"
    );
  });

  it("rejects environment mismatch", () => {
    const built = buildSampleArtifact({ environment: "Development" });
    assert.throws(
      () =>
        validateArtifactForUpload({
          artifactBuffer: built.artifactBuffer,
          environment: "Production",
          frequency: "daily",
          encryptionKey: TEST_KEY_HEX,
        }),
      (error) => error.code === "BACKUP_ENV_MISMATCH"
    );
  });

  it("rejects frequency mismatch", () => {
    const built = buildSampleArtifact({ frequency: "daily" });
    assert.throws(
      () =>
        validateArtifactForUpload({
          artifactBuffer: built.artifactBuffer,
          environment: "Development",
          frequency: "weekly",
          encryptionKey: TEST_KEY_HEX,
        }),
      (error) => error.code === "BACKUP_FREQUENCY_MISMATCH"
    );
  });

  it("requires encrypted artifact for upload", async () => {
    await assert.rejects(
      () =>
        uploadValidatedBackupArtifact({
          app: { connections: () => ({ getConnectionCredentials: async () => ({}) }) },
          artifactBuffer: Buffer.from("not-json"),
          environment: "Development",
          frequency: "daily",
          encryptionKey: TEST_KEY_HEX,
        }),
      (error) => error.code === "BACKUP_ARTIFACT_INVALID"
    );
  });

  it("uploads to Daily folder", async () => {
    let parentId = "";
    const built = buildSampleArtifact();
    const app = {
      connections: () => ({
        getConnectionCredentials: async () => ({
          headers: { Authorization: "Zoho-oauthtoken token" },
        }),
      }),
    };
    const result = await uploadValidatedBackupArtifact({
      app,
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "daily",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        parentId = parsed.searchParams.get("parent_id");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ attributes: { resource_id: "daily-file" } }],
          }),
        };
      },
    });
    assert.equal(parentId, FOLDER_IDS.BACKUP_WORKDRIVE_DAILY_FOLDER_ID);
    assert.equal(result.frequency, "daily");
    assert.equal(result.production_mutated, false);
  });

  it("uploads to Weekly folder", async () => {
    let parentId = "";
    const built = buildSampleArtifact({ frequency: "weekly" });
    await uploadValidatedBackupArtifact({
      app: {
        connections: () => ({
          getConnectionCredentials: async () => ({
            headers: { Authorization: "Zoho-oauthtoken token" },
          }),
        }),
      },
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "weekly",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async (url) => {
        parentId = new URL(url).searchParams.get("parent_id");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ attributes: { resource_id: "weekly-file" } }],
          }),
        };
      },
    });
    assert.equal(parentId, FOLDER_IDS.BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID);
  });

  it("uploads to Monthly folder", async () => {
    let parentId = "";
    const built = buildSampleArtifact({ frequency: "monthly" });
    await uploadValidatedBackupArtifact({
      app: {
        connections: () => ({
          getConnectionCredentials: async () => ({
            headers: { Authorization: "Zoho-oauthtoken token" },
          }),
        }),
      },
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "monthly",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async (url) => {
        parentId = new URL(url).searchParams.get("parent_id");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ attributes: { resource_id: "monthly-file" } }],
          }),
        };
      },
    });
    assert.equal(parentId, FOLDER_IDS.BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID);
  });

  it("uploads to Recovery-Test folder", async () => {
    let parentId = "";
    const built = buildSampleArtifact({ frequency: "recovery-test" });
    await uploadValidatedBackupArtifact({
      app: {
        connections: () => ({
          getConnectionCredentials: async () => ({
            headers: { Authorization: "Zoho-oauthtoken token" },
          }),
        }),
      },
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "recovery-test",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async (url) => {
        parentId = new URL(url).searchParams.get("parent_id");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ attributes: { resource_id: "recovery-file" } }],
          }),
        };
      },
    });
    assert.equal(parentId, FOLDER_IDS.BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID);
  });

  it("fails when folder id missing", async () => {
    const built = buildSampleArtifact();
    await assert.rejects(
      () =>
        uploadValidatedBackupArtifact({
          app: {
            connections: () => ({
              getConnectionCredentials: async () => ({
                headers: { Authorization: "Zoho-oauthtoken token" },
              }),
            }),
          },
          artifactBuffer: built.artifactBuffer,
          environment: "Development",
          frequency: "daily",
          encryptionKey: TEST_KEY_HEX,
          config: {
            connectionName: "zohodrive",
            apiBase: "https://workdrive.zoho.in/api/v1",
            downloadBase: "https://workdrive.zoho.in/download",
            folderIds: { daily: "", weekly: "", monthly: "", "recovery-test": "" },
          },
        }),
      (error) => error.code === "WORKDRIVE_FOLDER_MISSING"
    );
  });

  it("fails when WorkDrive connection missing", async () => {
    const built = buildSampleArtifact();
    await assert.rejects(
      () =>
        uploadValidatedBackupArtifact({
          app: {
            connections: () => ({
              getConnectionCredentials: async () => {
                throw new Error("not configured");
              },
            }),
          },
          artifactBuffer: built.artifactBuffer,
          environment: "Development",
          frequency: "daily",
          encryptionKey: TEST_KEY_HEX,
        }),
      (error) => error.code === "WORKDRIVE_CONNECTION_MISSING"
    );
  });

  it("renames duplicate filenames instead of overwriting", async () => {
    const built = buildSampleArtifact();
    let attempt = 0;
    const result = await uploadValidatedBackupArtifact({
      app: {
        connections: () => ({
          getConnectionCredentials: async () => ({
            headers: { Authorization: "Zoho-oauthtoken token" },
          }),
        }),
      },
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "daily",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async () => {
        attempt += 1;
        if (attempt === 1) {
          return {
            ok: false,
            status: DUPLICATE_STATUS,
            json: async () => ({ error: "duplicate" }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ attributes: { resource_id: "renamed-file" } }],
          }),
        };
      },
    });
    assert.equal(attempt, 2);
    assert.equal(result.duplicate_renamed, true);
    assert.ok(result.file_name.endsWith(".baylen-backup"));
  });

  it("generates unique upload filenames on conflict", () => {
    const original = "baylen-app-development-daily-2026-09-03T10-00-00Z-id.baylen-backup";
    const renamed = uniqueUploadFileName(original);
    assert.notEqual(renamed, original);
    assert.ok(renamed.endsWith(".baylen-backup"));
  });

  it("does not mutate production datastore during upload", async () => {
    const built = buildSampleArtifact();
    const result = await uploadValidatedBackupArtifact({
      app: {
        connections: () => ({
          getConnectionCredentials: async () => ({
            headers: { Authorization: "Zoho-oauthtoken token" },
          }),
        }),
      },
      artifactBuffer: built.artifactBuffer,
      environment: "Development",
      frequency: "daily",
      encryptionKey: TEST_KEY_HEX,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ attributes: { resource_id: "safe-file" } }],
        }),
      }),
    });
    assert.equal(result.production_mutated, false);
    assert.ok(result.workdrive_resource_id);
    assert.ok(result.uploaded_at);
    assert.equal(typeof result.total_rows, "number");
  });
});

describe("admin backup upload auth", () => {
  it("rejects requests without x-baylen-admin-key", () => {
    const adminKey = "a".repeat(32);
    const req = { headers: {} };
    const provided = Buffer.from(String(req.headers["x-baylen-admin-key"] || ""));
    const expected = Buffer.from(adminKey);
    const authorized =
      provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    assert.equal(authorized, false);
  });

  it("accepts matching x-baylen-admin-key", () => {
    const adminKey = "a".repeat(32);
    const req = { headers: { "x-baylen-admin-key": adminKey } };
    const provided = Buffer.from(String(req.headers["x-baylen-admin-key"] || ""));
    const expected = Buffer.from(adminKey);
    const authorized =
      provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
    assert.equal(authorized, true);
  });
});
