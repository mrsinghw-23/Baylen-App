"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { sha256Buffer } = require("./backup-crypto");
const {
  parseArtifactBuffer,
  decryptArtifact,
  buildEncryptedArtifact,
  createBackupId,
} = require("./backup-artifact");
const { validateManifest, verifyPayloadDigest } = require("./backup-manifest");
const { verifyArtifactCiphertextDigest } = require("./backup-artifact");

function createSecureTempDir(prefix = "baylen-backup-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (process.platform !== "win32") {
    fs.chmodSync(dir, 0o700);
  }
  return dir;
}

function secureDeletePath(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { deleted: false, verified: true };
  }
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(targetPath);
  }
  const verified = !fs.existsSync(targetPath);
  return { deleted: true, verified };
}

async function verifyEncryptedArtifact({
  artifactBuffer,
  encryptionKey,
  expectedEnvironment,
  expectedProjectId,
}) {
  let envelope;
  try {
    envelope = parseArtifactBuffer(artifactBuffer);
  } catch (error) {
    return { ok: false, stage: "artifact", errors: [error.message] };
  }
  const envelopeDigest = sha256Buffer(artifactBuffer);
  let payload;
  try {
    payload = decryptArtifact(envelope, encryptionKey);
  } catch (error) {
    return {
      ok: false,
      stage: "decrypt",
      errors: [error.code || error.message],
    };
  }
  const manifestErrors = validateManifest(payload.manifest, {
    expectedEnvironment,
    expectedProjectId,
  });
  if (manifestErrors.length) {
    return {
      ok: false,
      stage: "manifest",
      errors: manifestErrors,
    };
  }

  const cipherDigest = verifyArtifactCiphertextDigest(envelope, payload.manifest);
  if (!cipherDigest.ok) {
    return {
      ok: false,
      stage: "encrypted_artifact_sha256",
      errors: ["encrypted artifact digest mismatch"],
      expected: cipherDigest.expected,
      actual: cipherDigest.actual,
    };
  }

  const payloadDigest = verifyPayloadDigest(
    Buffer.from(JSON.stringify({ tables: payload.tables }), "utf8"),
    payload.manifest
  );
  if (!payloadDigest.ok) {
    return {
      ok: false,
      stage: "payload_sha256",
      errors: ["payload_sha256 mismatch"],
      expected: payloadDigest.expected,
      actual: payloadDigest.actual,
    };
  }

  return {
    ok: true,
    envelope,
    payload,
    envelopeDigest,
    ciphertextDigest: cipherDigest.actual,
    rowCounts: payload.manifest.row_counts,
    totalRows: payload.manifest.total_rows,
  };
}

async function runRecoveryVerification({
  artifactBuffer,
  encryptionKey,
  expectedEnvironment,
  expectedProjectId,
  uploadedResourceId,
  downloadImpl,
}) {
  let buffer = artifactBuffer;
  if (downloadImpl) {
    buffer = await downloadImpl(uploadedResourceId);
  }
  const result = await verifyEncryptedArtifact({
    artifactBuffer: buffer,
    encryptionKey,
    expectedEnvironment,
    expectedProjectId,
  });
  return {
    ...result,
    downloaded: Boolean(downloadImpl),
    productionMutated: false,
  };
}

module.exports = {
  createSecureTempDir,
  secureDeletePath,
  verifyEncryptedArtifact,
  runRecoveryVerification,
  createBackupId,
  buildEncryptedArtifact,
};
