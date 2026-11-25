"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseFilestoreRef,
} = require("../lib/delivery-partner-kyc-engine");

test("parseFilestoreRef reads Catalyst file ids", () => {
  assert.equal(parseFilestoreRef("filestore:123456"), "123456");
  assert.equal(parseFilestoreRef("FILESTORE:99"), "99");
  assert.equal(parseFilestoreRef("https://example.com/a.jpg"), "");
  assert.equal(parseFilestoreRef(""), "");
});
