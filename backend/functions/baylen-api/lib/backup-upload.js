"use strict";

const crypto = require("crypto");
const {
  ARTIFACT_EXTENSION,
  parseArtifactBuffer,
  buildArtifactFileName,
  createBackupId,
  verifyArtifactCiphertextDigest,
} = require("./backup-artifact");
const { ALGORITHM } = require("./backup-crypto");
const { normalizeEnvironment } = require("./backup-env");
const { decryptPayload } = require("./backup-crypto");
const { validateManifest } = require("./backup-manifest");
const {
  normalizeFrequency,
  resolveFolderId,
  uploadEncryptedArtifact,
  workdriveConfigFromEnv,
} = require("./backup-workdrive");

function resolveBackupEncryptionKey(env = process.env) {
  const raw = String(env.BACKUP_ENCRYPTION_KEY || "").trim();
  if (!raw && env.BACKUP_ENCRYPTION_KEY_FILE) {
    const fs = require("fs");
    const path = require("path");
    return fs.readFileSync(path.resolve(env.BACKUP_ENCRYPTION_KEY_FILE), "utf8").trim();
  }
  if (!raw) {
    const error = new Error("BACKUP_ENCRYPTION_KEY is required for backup upload verification");
    error.code = "BACKUP_KEY_MISSING";
    error.status = 503;
    throw error;
  }
  return raw;
}

function isPlaintextBackupArtifact(buffer) {
  if (!buffer || !buffer.length) {
    return false;
  }
  const head = buffer.slice(0, Math.min(buffer.length, 4096)).toString("utf8").trim();
  if (!head.startsWith("{") && !head.startsWith("[")) {
    return false;
  }
  try {
    const parsed = JSON.parse(buffer.toString("utf8"));
    if (Array.isArray(parsed)) {
      return true;
    }
    if (parsed && typeof parsed === "object") {
      if (parsed.tables && !parsed.encryptedPayload && parsed.version == null) {
        return true;
      }
      if (parsed.export_metadata && parsed.tables && !parsed.encryptedPayload) {
        return true;
      }
    }
  } catch (_) {
    return false;
  }
  return false;
}

function assertEncryptedArtifactBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error("Encrypted backup artifact body is required");
    error.code = "BACKUP_ARTIFACT_MISSING";
    error.status = 400;
    throw error;
  }
  if (isPlaintextBackupArtifact(buffer)) {
    const error = new Error("Plaintext backup content is not accepted — upload .baylen-backup only");
    error.code = "BACKUP_PLAINTEXT_REJECTED";
    error.status = 400;
    throw error;
  }
}

function decryptManifestFromEnvelope(envelope, encryptionKey) {
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const encrypted = Buffer.from(envelope.encryptedPayload, "base64");
  let plaintext;
  try {
    plaintext = decryptPayload({ iv, authTag, encrypted }, encryptionKey);
  } catch (_) {
    const error = new Error("Encrypted artifact failed authentication/decryption");
    error.code = "BACKUP_ARTIFACT_DECRYPT_FAILED";
    error.status = 400;
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch (_) {
    const error = new Error("Decrypted backup payload is invalid");
    error.code = "BACKUP_ARTIFACT_PAYLOAD_INVALID";
    error.status = 400;
    throw error;
  }
  if (!payload || !payload.manifest) {
    const error = new Error("Backup manifest missing inside encrypted payload");
    error.code = "BACKUP_MANIFEST_MISSING";
    error.status = 400;
    throw error;
  }
  return payload;
}

function validateArtifactForUpload({
  artifactBuffer,
  environment,
  frequency,
  encryptionKey,
  projectId,
}) {
  assertEncryptedArtifactBuffer(artifactBuffer);

  let envelope;
  try {
    envelope = parseArtifactBuffer(artifactBuffer);
  } catch (error) {
    const err = new Error("Invalid encrypted backup artifact format");
    err.code = "BACKUP_ARTIFACT_INVALID";
    err.status = 400;
    throw err;
  }

  if (envelope.algorithm !== ALGORITHM) {
    const error = new Error("Unsupported backup encryption algorithm");
    error.code = "BACKUP_ALGORITHM_UNSUPPORTED";
    error.status = 400;
    throw error;
  }

  const expectedEnv = normalizeEnvironment(environment);
  const expectedFreq = normalizeFrequency(frequency);
  const envelopeEnv = normalizeEnvironment(envelope.environment);
  const envelopeFreq = normalizeFrequency(envelope.frequency || expectedFreq);

  if (envelopeEnv !== expectedEnv) {
    const error = new Error(
      "Artifact environment " + envelopeEnv + " does not match requested " + expectedEnv
    );
    error.code = "BACKUP_ENV_MISMATCH";
    error.status = 400;
    throw error;
  }
  if (envelopeFreq !== expectedFreq) {
    const error = new Error(
      "Artifact frequency " + envelopeFreq + " does not match requested " + expectedFreq
    );
    error.code = "BACKUP_FREQUENCY_MISMATCH";
    error.status = 400;
    throw error;
  }

  const key = encryptionKey || resolveBackupEncryptionKey();
  const payload = decryptManifestFromEnvelope(envelope, key);
  const manifestErrors = validateManifest(payload.manifest, {
    expectedEnvironment: expectedEnv,
    expectedProjectId: projectId || envelope.projectId,
  });
  if (manifestErrors.length) {
    const error = new Error("Backup manifest validation failed");
    error.code = "BACKUP_MANIFEST_INVALID";
    error.status = 400;
    error.details = manifestErrors;
    throw error;
  }

  if (payload.manifest.frequency && normalizeFrequency(payload.manifest.frequency) !== expectedFreq) {
    const error = new Error("Manifest frequency does not match request");
    error.code = "BACKUP_FREQUENCY_MISMATCH";
    error.status = 400;
    throw error;
  }

  const cipherDigest = verifyArtifactCiphertextDigest(envelope, payload.manifest);
  if (!cipherDigest.ok) {
    const error = new Error("Encrypted artifact SHA-256 integrity check failed");
    error.code = "BACKUP_INTEGRITY_FAILED";
    error.status = 400;
    throw error;
  }

  const fileName =
    envelope.backupId && envelope.createdAt
      ? buildArtifactFileName({
          environment: expectedEnv,
          frequency: expectedFreq,
          createdAt: envelope.createdAt,
          backupId: envelope.backupId,
        })
      : "baylen-app-" +
        expectedEnv.toLowerCase() +
        "-" +
        expectedFreq +
        "-" +
        createBackupId() +
        ARTIFACT_EXTENSION;

  if (!fileName.endsWith(ARTIFACT_EXTENSION)) {
    const error = new Error("Backup file name must use " + ARTIFACT_EXTENSION);
    error.code = "BACKUP_FILENAME_INVALID";
    error.status = 400;
    throw error;
  }

  return {
    envelope,
    manifest: payload.manifest,
    fileName,
    totalRows: payload.manifest.total_rows,
    backupId: payload.manifest.backup_id || envelope.backupId,
  };
}

function uniqueUploadFileName(fileName) {
  const suffix = crypto.randomUUID().slice(0, 8);
  if (fileName.endsWith(ARTIFACT_EXTENSION)) {
    return fileName.replace(ARTIFACT_EXTENSION, "-" + suffix + ARTIFACT_EXTENSION);
  }
  return fileName + "-" + suffix;
}

async function uploadValidatedBackupArtifact({
  app,
  artifactBuffer,
  environment,
  frequency,
  config = workdriveConfigFromEnv(),
  encryptionKey,
  projectId,
  fetchImpl,
  maxAttempts = 3,
}) {
  const validation = validateArtifactForUpload({
    artifactBuffer,
    environment,
    frequency,
    encryptionKey,
    projectId,
  });
  const folderId = resolveFolderId(frequency, config);
  let fileName = validation.fileName;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const upload = await uploadEncryptedArtifact({
        app,
        buffer: artifactBuffer,
        fileName,
        folderId,
        config,
        overrideNameExist: false,
        fetchImpl,
      });
      return {
        ok: true,
        backup_id: validation.backupId,
        environment: normalizeEnvironment(environment),
        frequency: normalizeFrequency(frequency),
        folder_id: folderId,
        file_name: upload.fileName,
        workdrive_resource_id: upload.resourceId,
        uploaded_at: new Date().toISOString(),
        total_rows: validation.totalRows,
        duplicate_renamed: fileName !== validation.fileName,
        production_mutated: false,
      };
    } catch (error) {
      lastError = error;
      if (error.code === "WORKDRIVE_DUPLICATE" && attempt < maxAttempts - 1) {
        fileName = uniqueUploadFileName(validation.fileName);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("WorkDrive upload failed");
}

function parseUploadRequestBody(req) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) {
    const body = req.body || {};
    const environment = body.environment;
    const frequency = body.frequency || "daily";
    let buffer = null;
    if (body.artifact_base64) {
      buffer = Buffer.from(String(body.artifact_base64), "base64");
    } else if (body.artifact && typeof body.artifact === "string") {
      buffer = Buffer.from(body.artifact, "base64");
    }
    return { environment, frequency, artifactBuffer: buffer };
  }
  if (
    Buffer.isBuffer(req.body) &&
    req.body.length &&
    !contentType.includes("application/json")
  ) {
    const environment = req.query.environment || req.headers["x-baylen-backup-env"];
    const frequency = req.query.frequency || req.headers["x-baylen-backup-frequency"] || "daily";
    return { environment, frequency, artifactBuffer: req.body };
  }
  const body = req.body || {};
  if (body.artifact_base64) {
    return {
      environment: body.environment,
      frequency: body.frequency || "daily",
      artifactBuffer: Buffer.from(String(body.artifact_base64), "base64"),
    };
  }
  return {
    environment: body.environment,
    frequency: body.frequency || "daily",
    artifactBuffer: null,
  };
}

module.exports = {
  resolveBackupEncryptionKey,
  isPlaintextBackupArtifact,
  assertEncryptedArtifactBuffer,
  validateArtifactForUpload,
  uploadValidatedBackupArtifact,
  parseUploadRequestBody,
  uniqueUploadFileName,
};
