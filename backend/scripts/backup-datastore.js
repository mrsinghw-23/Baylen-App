#!/usr/bin/env node
"use strict";

/**
 * Baylen encrypted Data Store backup CLI.
 *
 * Examples:
 *   node backend/scripts/backup-datastore.js --env Development --mode full --frequency daily
 *   node backend/scripts/backup-datastore.js --env Production --mode full --frequency weekly
 *
 * Requires:
 *   BACKUP_ENCRYPTION_KEY (32-byte key, base64 or 64-char hex)
 *   WORKDRIVE_CONNECTION_NAME + tier folder IDs for upload modes
 */

const path = require("path");
const fs = require("fs");

// Catalyst SDK resolves .catalystrc from process.cwd() — pin to backend project root.
process.chdir(path.resolve(__dirname, "../.."));

if (!process.env.BACKUP_ENCRYPTION_KEY && process.env.BACKUP_ENCRYPTION_KEY_FILE) {
  const keyPath = path.resolve(process.env.BACKUP_ENCRYPTION_KEY_FILE);
  process.env.BACKUP_ENCRYPTION_KEY = fs.readFileSync(keyPath, "utf8").trim();
}

const { parseBackupCliArgs, runBackupPipeline } = require(
  path.join(__dirname, "../functions/baylen-api/lib/backup-pipeline")
);

async function main() {
  const cli = parseBackupCliArgs(process.argv);
  console.log(
    JSON.stringify(
      {
        message: "Starting Baylen backup",
        environment: cli.env,
        mode: cli.mode,
        frequency: cli.frequency,
      },
      null,
      2
    )
  );

  const result = await runBackupPipeline({
    env: cli.env,
    mode: cli.mode,
    frequency: cli.frequency,
    outDir: cli.outDir ? path.resolve(cli.outDir) : "",
    artifactPath: cli.artifactPath,
    resourceId: cli.resourceId,
    includeOptional: cli.includeOptional,
    catalystRcPath: cli.catalystRcPath,
    projectId: cli.projectId,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: error.code || "BACKUP_FAILED",
        message: error.message || String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
