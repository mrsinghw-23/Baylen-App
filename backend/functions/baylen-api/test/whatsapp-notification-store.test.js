"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { serializeTemplateVariables } = require("../lib/whatsapp-notification-store");

describe("whatsapp notification store", () => {
  it("serializes template variable arrays as JSON", () => {
    const json = serializeTemplateVariables(["Mr Singh", "BAY376843"]);
    assert.equal(json, '["Mr Singh","BAY376843"]');
  });

  it("returns empty string when no variables are provided", () => {
    assert.equal(serializeTemplateVariables([]), "");
    assert.equal(serializeTemplateVariables(null), "");
  });
});
