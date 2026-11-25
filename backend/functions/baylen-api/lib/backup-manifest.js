"use strict";

const { SCHEMA_VERSION } = require("./backup-table-scope");
const { ALGORITHM, sha256Buffer } = require("./backup-crypto");

function buildManifest({
  backupId,
  projectId,
  environment,
  createdAt,
  frequency,
  includedTables,
  rowCounts,
  payloadSha256,
  encryptedArtifactSha256,
}) {
  const totalRows = Object.values(rowCounts).reduce(
    (sum, count) => sum + (Number.isFinite(Number(count)) ? Number(count) : 0),
    0
  );
  return {
    backup_id: backupId,
    project_id: projectId,
    environment,
    created_at: createdAt,
    frequency,
    algorithm: ALGORITHM,
    schema_version: SCHEMA_VERSION,
    included_tables: [...includedTables].sort((a, b) => a.localeCompare(b)),
    row_counts: { ...rowCounts },
    total_rows: totalRows,
    payload_sha256: payloadSha256,
    encrypted_artifact_sha256: encryptedArtifactSha256 || "",
  };
}

function validateManifest(manifest, { expectedEnvironment, expectedProjectId } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest missing or invalid"];
  }
  const required = [
    "backup_id",
    "project_id",
    "environment",
    "created_at",
    "frequency",
    "algorithm",
    "schema_version",
    "included_tables",
    "row_counts",
    "total_rows",
    "payload_sha256",
  ];
  for (const field of required) {
    if (manifest[field] === undefined || manifest[field] === null || manifest[field] === "") {
      errors.push("manifest." + field + " missing");
    }
  }
  if (expectedEnvironment && manifest.environment !== expectedEnvironment) {
    errors.push(
      "environment mismatch: expected " + expectedEnvironment + " got " + manifest.environment
    );
  }
  if (expectedProjectId && String(manifest.project_id) !== String(expectedProjectId)) {
    errors.push("project_id mismatch");
  }
  if (manifest.algorithm !== ALGORITHM) {
    errors.push("unsupported algorithm: " + manifest.algorithm);
  }
  if (manifest.schema_version !== SCHEMA_VERSION) {
    errors.push("unsupported schema_version: " + manifest.schema_version);
  }
  const counted = Object.values(manifest.row_counts || {}).reduce(
    (sum, count) => sum + Number(count || 0),
    0
  );
  if (Number(manifest.total_rows) !== counted) {
    errors.push("total_rows does not match row_counts sum");
  }
  return errors;
}

function verifyPayloadDigest(payloadBuffer, manifest) {
  const digest = sha256Buffer(payloadBuffer);
  if (digest !== manifest.payload_sha256) {
    return {
      ok: false,
      expected: manifest.payload_sha256,
      actual: digest,
    };
  }
  return { ok: true, digest };
}

module.exports = {
  buildManifest,
  validateManifest,
  verifyPayloadDigest,
};
