"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, csvObjects, packageCsvHeaderRow } = require("../lib/salon-import-pipeline");

test("package CSV header matches contract", () => {
  const header = packageCsvHeaderRow();
  assert.ok(header.includes("salon_code"));
  assert.ok(header.includes("service_code"));
  assert.ok(header.includes("male_price"));
  assert.ok(header.includes("female_price"));
});

test("csvObjects rejects missing required headers", () => {
  assert.throws(() => csvObjects("salon_code,service_name\nA,B\n"), /missing required headers/i);
});

test("csvObjects parses gender-split service rows", () => {
  const csv =
    packageCsvHeaderRow() +
    "\n" +
    [
      '"36851000000307517"',
      "BAYLEN-RNC-001",
      "",
      "",
      "",
      "",
      "",
      "",
      "GOLD",
      "gold",
      "Hair",
      "",
      "SVC-HAIRCUT",
      "Hair Cut",
      "hair-cut",
      "Cut and finish",
      "MALE",
      "500",
      "",
      "",
      "45",
      "true",
      "false",
      "false",
      "STF-001",
      "Rohit Sharma",
      "MALE",
      "",
      "4.8",
      "8",
      "true",
      "",
      "",
      "",
      "",
      "haircut,hair cut",
      "",
      "",
      "ACTIVE",
      "1",
      "",
      "",
    ].join(",") +
    "\n" +
    [
      '"36851000000307517"',
      "BAYLEN-RNC-001",
      "",
      "",
      "",
      "",
      "",
      "",
      "GOLD",
      "gold",
      "Hair",
      "",
      "SVC-HAIRCUT",
      "Hair Cut",
      "hair-cut",
      "Cut and finish",
      "FEMALE",
      "",
      "600",
      "",
      "45",
      "false",
      "true",
      "false",
      "STF-001",
      "Rohit Sharma",
      "MALE",
      "",
      "4.8",
      "8",
      "true",
      "",
      "",
      "",
      "",
      "haircut,hair cut",
      "",
      "",
      "ACTIVE",
      "1",
      "",
      "",
    ].join(",");
  const rows = csvObjects(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].service_gender, "MALE");
  assert.equal(rows[1].service_gender, "FEMALE");
});
