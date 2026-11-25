"use strict";

if (!process.argv.some((arg, index) => arg === "--env" && process.argv[index + 1])) {
  console.error(
    "export-datastore-snapshot.js no longer runs without explicit --env.\n" +
      "Use: node backend/scripts/backup-datastore.js --env Development --mode export\n" +
      "See backend/docs/hybrid-commerce/BACKUP_RECOVERY.md"
  );
  process.exit(1);
}

require("./backup-datastore.js");
