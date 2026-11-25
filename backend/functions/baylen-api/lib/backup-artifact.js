"use strict";

const { ALGORITHM, encryptPayload, decryptPayload, sha256Buffer } = require("./backup-crypto");
const { buildManifest } = require("./backup-manifest");

const ARTIFACT_VERSION = 1;
const ARTIFACT_EXTENSION = ".baylen-backup";

function createBackupId() {
  return require("crypto").randomUUID();
}

function utcTimestampForFilename(isoString) {
  return String(isoString || new Date().toISOString())
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

function buildArtifactFileName({ environment, frequency, createdAt, backupId }) {
  const envSlug = String(environment || "unknown").toLowerCase();
  const freqSlug = String(frequency || "daily").toLowerCase();
  const stamp = utcTimestampForFilename(createdAt);
  return (
    "baylen-app-" + envSlug + "-" + freqSlug + "-" + stamp + "-" + backupId + ARTIFACT_EXTENSION
  );
}

function buildEncryptedArtifact({
  snapshot,
  backupId,
  projectId,
  environment,
  frequency,
  encryptionKey,
  createdAt,
}) {
  const created = createdAt || new Date().toISOString();
  const tablesDigestSource = Buffer.from(JSON.stringify({ tables: snapshot.tables }), "utf8");
  const payloadSha256 = sha256Buffer(tablesDigestSource);

  const manifest = buildManifest({
    backupId,
    projectId,
    environment,
    createdAt: created,
    frequency,
    includedTables: Object.keys(snapshot.tables),
    rowCounts: snapshot.row_counts,
    payloadSha256,
    encryptedArtifactSha256: "",
  });

  const plaintextPayload = Buffer.from(
    JSON.stringify({
      manifest,
      export_metadata: snapshot.export_metadata,
      tables: snapshot.tables,
    }),
    "utf8"
  );

  const { iv, authTag, encrypted } = encryptPayload(plaintextPayload, encryptionKey);
  manifest.encrypted_artifact_sha256 = sha256Buffer(encrypted);

  const artifact = {
    version: ARTIFACT_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    environment,
    createdAt: created,
    projectId,
    backupId,
    frequency,
    encryptedPayload: encrypted.toString("base64"),
  };

  return {
    artifact,
    artifactBuffer: Buffer.from(JSON.stringify(artifact), "utf8"),
    fileName: buildArtifactFileName({
      environment,
      frequency,
      createdAt: created,
      backupId,
    }),
    manifest,
  };
}

function parseArtifactBuffer(buffer) {
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch (_) {
    const err = new Error("Invalid .baylen-backup JSON envelope");
    err.code = "ARTIFACT_PARSE_FAILED";
    throw err;
  }
  if (!parsed || parsed.version !== ARTIFACT_VERSION) {
    const err = new Error("Unsupported artifact version");
    err.code = "ARTIFACT_VERSION_UNSUPPORTED";
    throw err;
  }
  return parsed;
}

function decryptArtifact(artifact, encryptionKey) {
  const iv = Buffer.from(artifact.iv, "base64");
  const authTag = Buffer.from(artifact.authTag, "base64");
  const encrypted = Buffer.from(artifact.encryptedPayload, "base64");
  let plaintext;
  try {
    plaintext = decryptPayload({ iv, authTag, encrypted }, encryptionKey);
  } catch (error) {
    const err = new Error("Artifact decryption/authentication failed");
    err.code = "ARTIFACT_DECRYPT_FAILED";
    err.cause = error;
    throw err;
  }
  let payload;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch (_) {
    const err = new Error("Decrypted payload is not valid JSON");
    err.code = "ARTIFACT_PAYLOAD_INVALID";
    throw err;
  }
  return payload;
}

function verifyArtifactCiphertextDigest(artifact, manifest) {
  const encrypted = Buffer.from(artifact.encryptedPayload, "base64");
  const actual = sha256Buffer(encrypted);
  if (manifest.encrypted_artifact_sha256 && manifest.encrypted_artifact_sha256 !== actual) {
    return { ok: false, expected: manifest.encrypted_artifact_sha256, actual };
  }
  return { ok: true, actual };
}

module.exports = {
  ARTIFACT_VERSION,
  ARTIFACT_EXTENSION,
  createBackupId,
  buildArtifactFileName,
  buildEncryptedArtifact,
  parseArtifactBuffer,
  decryptArtifact,
  verifyArtifactCiphertextDigest,
  utcTimestampForFilename,
};
