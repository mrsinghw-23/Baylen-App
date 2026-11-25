"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  parseBaylenOrderSequence,
  maxOrderSequenceForYear,
  formatBaylenOrderNumber,
  nextOrderNumber,
} = require("../lib/checkout-engine");

const YEAR = "2026";

function nextFor(orderNumbers) {
  const maxSeq = maxOrderSequenceForYear(orderNumbers, YEAR);
  return formatBaylenOrderNumber(YEAR, maxSeq + 1);
}

describe("parseBaylenOrderSequence", () => {
  it("parses master and split-child order numbers", () => {
    assert.deepEqual(parseBaylenOrderSequence("BLN-2026-000001"), {
      year: "2026",
      sequence: 1,
    });
    assert.deepEqual(parseBaylenOrderSequence("BLN-2026-000001-2"), {
      year: "2026",
      sequence: 1,
    });
  });

  it("ignores malformed order numbers", () => {
    assert.equal(parseBaylenOrderSequence(""), null);
    assert.equal(parseBaylenOrderSequence("ORDER-123"), null);
    assert.equal(parseBaylenOrderSequence("BLN-2026"), null);
    assert.equal(parseBaylenOrderSequence("BLN-2026-ABC"), null);
    assert.equal(parseBaylenOrderSequence(null), null);
  });
});

describe("nextOrderNumber sequence selection", () => {
  it("A. no existing orders → 000001", () => {
    assert.equal(nextFor([]), "BLN-2026-000001");
    assert.equal(nextFor(null), "BLN-2026-000001");
  });

  it("B. existing 000001 → 000002", () => {
    assert.equal(nextFor(["BLN-2026-000001"]), "BLN-2026-000002");
  });

  it("C. existing 000001 + 000003 → 000004", () => {
    assert.equal(
      nextFor(["BLN-2026-000001", "BLN-2026-000003"]),
      "BLN-2026-000004"
    );
  });

  it("D. duplicate 000001 rows → next number still calculated correctly", () => {
    assert.equal(
      nextFor([
        "BLN-2026-000001",
        "BLN-2026-000001",
        "BLN-2026-000001",
      ]),
      "BLN-2026-000002"
    );
  });

  it("E. different-year orders ignored", () => {
    assert.equal(
      nextFor(["BLN-2025-000099", "BLN-2024-000050"]),
      "BLN-2026-000001"
    );
    assert.equal(
      nextFor(["BLN-2025-000099", "BLN-2026-000002"]),
      "BLN-2026-000003"
    );
  });

  it("F. malformed order numbers ignored", () => {
    assert.equal(
      nextFor([
        "BLN-2026-000001",
        "legacy-order",
        "",
        "BLN-2026-ABC",
        "SALON-2026-000010",
      ]),
      "BLN-2026-000002"
    );
  });

  it("G. current-year highest sequence correctly selected", () => {
    assert.equal(
      nextFor([
        "BLN-2026-000001",
        "BLN-2026-000005",
        "BLN-2026-000003",
        "BLN-2025-999999",
      ]),
      "BLN-2026-000006"
    );
    assert.equal(maxOrderSequenceForYear(["BLN-2026-000005"], YEAR), 5);
  });
});

describe("nextOrderNumber async lookup", () => {
  it("reads all order_number rows without LIKE and formats the next value", async () => {
    const zcql = {
      executeZCQLQuery: async (query) => {
        assert.match(query, /SELECT order_number FROM Orders/);
        assert.doesNotMatch(query, /LIKE/i);
        return [
          { Orders: { order_number: "BLN-2026-000001" } },
          { Orders: { order_number: "BLN-2026-000001" } },
          { Orders: { order_number: "BLN-2025-000010" } },
        ];
      },
    };
    const year = String(new Date().getFullYear());
    const next = await nextOrderNumber(zcql);
    assert.equal(next, formatBaylenOrderNumber(year, 2));
  });

  it("returns 000001 when the Orders scan fails", async () => {
    const zcql = {
      executeZCQLQuery: async () => {
        throw new Error("ZCQL unavailable");
      },
    };
    const year = String(new Date().getFullYear());
    assert.equal(await nextOrderNumber(zcql), formatBaylenOrderNumber(year, 1));
  });
});
