"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function decodeEncryptionKey(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    const error = new Error("BACKUP_ENCRYPTION_KEY is required");
    error.code = "BACKUP_KEY_MISSING";
    throw error;
  }

  let keyBuffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    keyBuffer = Buffer.from(value, "hex");
  } else {
    try {
      keyBuffer = Buffer.from(value, "base64");
    } catch (_) {
      keyBuffer = Buffer.from(value, "utf8");
    }
  }

  if (keyBuffer.length !== KEY_BYTES) {
    const error = new Error(
      "BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits)"
    );
    error.code = "BACKUP_KEY_INVALID";
    throw error;
  }
  return keyBuffer;
}

function encryptPayload(plaintextBuffer, encryptionKey) {
  const key = decodeEncryptionKey(encryptionKey);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv, authTag, encrypted };
}

function decryptPayload({ iv, authTag, encrypted }, encryptionKey) {
  const key = decodeEncryptionKey(encryptionKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = {
  ALGORITHM,
  IV_BYTES,
  KEY_BYTES,
  decodeEncryptionKey,
  encryptPayload,
  decryptPayload,
  sha256Buffer,
};
