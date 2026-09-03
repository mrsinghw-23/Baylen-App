"use strict";

const fs = require("fs");
const path = require("path");
const apiRoot = path.resolve(__dirname, "../functions/baylen-api");
const catalyst = require(path.join(apiRoot, "node_modules/zcatalyst-sdk-node"));
const { importSalonRecords } = require(path.join(apiRoot, "lib/salon-import-pipeline"));

async function main() {
  const filePath =
    process.argv[2] ||
    path.resolve(__dirname, "../seeds/salon/salon-gold.csv");
  const csvText = fs.readFileSync(filePath, "utf8");
  const app = catalyst.initialize({}, { scope: "admin" });
  const result = await importSalonRecords(app, csvText, { continue_on_error: true });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
