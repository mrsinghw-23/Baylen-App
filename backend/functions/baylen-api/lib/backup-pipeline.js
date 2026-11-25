"use strict";

const fs = require("fs");
const path = require("path");
const { defaultExportTables } = require("./backup-table-scope");
const { createVerifiedCatalystApp } = require("./backup-catalyst");
const { exportDatastoreSnapshot } = require("./backup-export");
const { createBackupId, buildEncryptedArtifact } = require("./backup-artifact");
const {
  normalizeFrequency,
  resolveFolderId,
  uploadEncryptedArtifact,
  workdriveConfigFromEnv,
} = require("./backup-workdrive");
const {
  createSecureTempDir,
  secureDeletePath,
  verifyEncryptedArtifact,
  runRecoveryVerification,
} = require("./backup-recovery");
const { parseArtifactBuffer, verifyArtifactCiphertextDigest } = require("./backup-artifact");

const VALID_MODES = ["export", "encrypt", "upload", "full", "verify"];

function parseBackupCliArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    env: "",
    mode: "full",
    frequency: "daily",
    outDir: "",
    artifactPath: "",
    resourceId: "",
    includeOptional: true,
    catalystRcPath: "",
    projectId: "",
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--env" && args[i + 1]) {
      parsed.env = args[i + 1];
      i += 1;
    } else if (token === "--mode" && args[i + 1]) {
      parsed.mode = String(args[i + 1]).toLowerCase();
      i += 1;
    } else if (token === "--frequency" && args[i + 1]) {
      parsed.frequency = args[i + 1];
      i += 1;
    } else if (token === "--out" && args[i + 1]) {
      parsed.outDir = args[i + 1];
      i += 1;
    } else if (token === "--artifact" && args[i + 1]) {
      parsed.artifactPath = args[i + 1];
      i += 1;
    } else if (token === "--resource-id" && args[i + 1]) {
      parsed.resourceId = args[i + 1];
      i += 1;
    } else if (token === "--no-optional") {
      parsed.includeOptional = false;
    } else if (token === "--catalystrc" && args[i + 1]) {
      parsed.catalystRcPath = args[i + 1];
      i += 1;
    } else if (token === "--project-id" && args[i + 1]) {
      parsed.projectId = args[i + 1];
      i += 1;
    }
  }

  if (!parsed.env) {
    const error = new Error("--env is mandatory (Development or Production)");
    error.code = "ENV_REQUIRED";
    throw error;
  }
  if (!VALID_MODES.includes(parsed.mode)) {
    const error = new Error("Invalid --mode. Allowed: " + VALID_MODES.join(", "));
    error.code = "MODE_INVALID";
    throw error;
  }
  normalizeFrequency(parsed.frequency);
  return parsed;
}

async function runBackupPipeline(options = {}) {
  const mode = options.mode || "full";
  const frequency = normalizeFrequency(options.frequency || "daily");
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;
  const workdriveConfig = workdriveConfigFromEnv(options.envVars || process.env);
  const tables = defaultExportTables({ includeOptional: options.includeOptional !== false });
  const backupId = options.backupId || createBackupId();

  const result = {
    backupId,
    mode,
    frequency,
    environment: options.env,
    stages: {},
  };

  let snapshot = options.snapshot || null;
  let artifactBuffer = options.artifactBuffer || null;
  let artifactMeta = options.artifactMeta || null;
  let tempDir = "";

  const needsExport = mode === "export" || mode === "encrypt" || mode === "full";
  const needsEncrypt = mode === "encrypt" || mode === "full";
  const needsUpload = mode === "upload" || mode === "full";
  const needsVerify = mode === "verify" || mode === "full";

  let app = options.app || null;
  let resolved = options.resolved || null;

  if (needsExport || needsUpload) {
    const boot = await createVerifiedCatalystApp({
      env: options.env,
      projectId: options.projectId,
      catalystRcPath: options.catalystRcPath,
    });
    app = boot.app;
    resolved = boot.resolved;
    result.stages.environment = {
      ok: true,
      environment: resolved.environment,
      projectId: resolved.projectId,
    };
  } else {
    resolved = require("./backup-env").resolveEnvironmentTarget({
      env: options.env,
      projectId: options.projectId,
      catalystRcPath: options.catalystRcPath,
    });
    result.resolved = resolved;
    result.stages.environment = {
      ok: true,
      environment: resolved.environment,
      projectId: resolved.projectId,
    };
    if (needsUpload) {
      const boot = await createVerifiedCatalystApp({
        env: options.env,
        projectId: options.projectId,
        catalystRcPath: options.catalystRcPath,
      });
      app = boot.app;
    }
  }

  if (needsExport) {
    tempDir = createSecureTempDir();
    snapshot = await exportDatastoreSnapshot(app, {
      tables,
      environment: resolved.environment,
      projectId: resolved.projectId,
      exportedAt: new Date().toISOString(),
    });
    result.stages.export = {
      ok: true,
      rowCounts: snapshot.row_counts,
      totalRows: Object.values(snapshot.row_counts).reduce((a, b) => a + b, 0),
      tempDir,
    };
    if (mode === "export" && options.outDir) {
      fs.mkdirSync(options.outDir, { recursive: true });
      fs.writeFileSync(
        path.join(options.outDir, "export-metadata.json"),
        JSON.stringify(snapshot.export_metadata, null, 2),
        "utf8"
      );
    }
  }

  if (needsEncrypt) {
    if (!snapshot && options.artifactPath) {
      throw new Error("encrypt mode requires export snapshot in-memory");
    }
    if (!encryptionKey) {
      const error = new Error("BACKUP_ENCRYPTION_KEY is required for encryption");
      error.code = "BACKUP_KEY_MISSING";
      throw error;
    }
    artifactMeta = buildEncryptedArtifact({
      snapshot,
      backupId,
      projectId: resolved.projectId,
      environment: resolved.environment,
      frequency,
      encryptionKey,
    });
    artifactBuffer = artifactMeta.artifactBuffer;

    const preVerify = await verifyEncryptedArtifact({
      artifactBuffer,
      encryptionKey,
      expectedEnvironment: resolved.environment,
      expectedProjectId: resolved.projectId,
    });
    result.stages.encrypt = {
      ok: preVerify.ok,
      fileName: artifactMeta.fileName,
      manifest: {
        backup_id: artifactMeta.manifest.backup_id,
        total_rows: artifactMeta.manifest.total_rows,
        included_tables: artifactMeta.manifest.included_tables.length,
      },
      verify: preVerify.ok ? "pass" : preVerify.errors,
    };
    if (!preVerify.ok) {
      throw new Error("Encryption self-verify failed: " + (preVerify.errors || []).join(", "));
    }
    if (options.outDir) {
      fs.mkdirSync(options.outDir, { recursive: true });
      fs.writeFileSync(path.join(options.outDir, artifactMeta.fileName), artifactBuffer);
    }
  }

  if (needsUpload) {
    if (!artifactBuffer) {
      if (options.artifactPath) {
        artifactBuffer = fs.readFileSync(path.resolve(options.artifactPath));
      } else {
        throw new Error("upload mode requires encrypted artifact buffer or --artifact path");
      }
    }
    const folderId = resolveFolderId(frequency, workdriveConfig);
    const fileName =
      (artifactMeta && artifactMeta.fileName) ||
      path.basename(options.artifactPath || "baylen-backup" + backupId + ".baylen-backup");

    let uploadResult;
    try {
      uploadResult = await uploadEncryptedArtifact({
        app,
        buffer: artifactBuffer,
        fileName,
        folderId,
        config: workdriveConfig,
        overrideNameExist: false,
      });
    } catch (error) {
      if (error.code === "WORKDRIVE_DUPLICATE") {
        const altName = fileName.replace(
          ".baylen-backup",
          "-" + createBackupId().slice(0, 8) + ".baylen-backup"
        );
        uploadResult = await uploadEncryptedArtifact({
          app,
          buffer: artifactBuffer,
          fileName: altName,
          folderId,
          config: workdriveConfig,
          overrideNameExist: false,
        });
        uploadResult.duplicateRenamed = true;
      } else {
        throw error;
      }
    }

    result.stages.upload = {
      ok: true,
      folderId,
      fileName: uploadResult.fileName,
      resourceId: uploadResult.resourceId,
      duplicateRenamed: Boolean(uploadResult.duplicateRenamed),
    };
  }

  if (needsVerify) {
    if (!artifactBuffer && options.artifactPath) {
      artifactBuffer = fs.readFileSync(path.resolve(options.artifactPath));
    }
    if (!encryptionKey) {
      const error = new Error("BACKUP_ENCRYPTION_KEY is required for verification");
      error.code = "BACKUP_KEY_MISSING";
      throw error;
    }
    const verify = await verifyEncryptedArtifact({
      artifactBuffer,
      encryptionKey,
      expectedEnvironment: resolved.environment,
      expectedProjectId: resolved.projectId,
    });
    result.stages.verify = {
      ok: verify.ok,
      totalRows: verify.totalRows,
      errors: verify.errors || [],
    };
  }

  if (tempDir) {
    const cleanup = secureDeletePath(tempDir);
    result.stages.cleanup = cleanup;
  }

  result.ok = Object.values(result.stages).every((stage) => stage.ok !== false);
  return result;
}

module.exports = {
  VALID_MODES,
  parseBackupCliArgs,
  runBackupPipeline,
  runRecoveryVerification,
};
