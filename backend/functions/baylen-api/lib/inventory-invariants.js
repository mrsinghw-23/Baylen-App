"use strict";

const { num } = require("./http");

function availableOfRow(row) {
  return Math.max(
    0,
    num(row.quantity_on_hand) - num(row.quantity_reserved) - num(row.quantity_committed)
  );
}

function validateInventoryInvariants(row, context) {
  const onHand = num(row.quantity_on_hand);
  const reserved = num(row.quantity_reserved);
  const committed = num(row.quantity_committed);
  const violations = [];

  if (onHand < 0) violations.push("quantity_on_hand negative");
  if (reserved < 0) violations.push("quantity_reserved negative");
  if (committed < 0) violations.push("quantity_committed negative");
  if (reserved + committed > onHand) {
    violations.push("reserved+committed exceeds on_hand");
  }
  if (availableOfRow(row) < 0) violations.push("available negative");

  if (violations.length) {
    const error = new Error(
      "Inventory invariant violation" +
        (context ? " (" + context + ")" : "") +
        ": " +
        violations.join(", ")
    );
    error.status = 409;
    error.code = "INVENTORY_INVARIANT_VIOLATION";
    error.details = {
      inventory_id: row.ROWID ? String(row.ROWID) : null,
      quantity_on_hand: onHand,
      quantity_reserved: reserved,
      quantity_committed: committed,
      available: availableOfRow(row),
      violations,
    };
    throw error;
  }

  return {
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    quantity_committed: committed,
    available: availableOfRow(row),
  };
}

module.exports = {
  availableOfRow,
  validateInventoryInvariants,
};
