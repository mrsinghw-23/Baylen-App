function asId(value, field) {
  const n = String(value ?? "").trim();
  if (!/^\d+$/.test(n)) {
    const error = new Error(`${field} must be a numeric id`);
    error.status = 400;
    throw error;
  }
  return n;
}

function asQty(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    const error = new Error(`${field} must be a positive integer`);
    error.status = 400;
    throw error;
  }
  return n;
}

function asText(value, field, max) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) {
    const error = new Error(`${field} is required and must be at most ${max} characters`);
    error.status = 400;
    throw error;
  }
  if (!/^[A-Za-z0-9 _\-:/]+$/.test(text)) {
    const error = new Error(`${field} contains invalid characters`);
    error.status = 400;
    throw error;
  }
  return text.replace(/'/g, "");
}

function optionalText(value, field, max) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length > max) {
    const error = new Error(`${field} must be at most ${max} characters`);
    error.status = 400;
    throw error;
  }
  return text.replace(/'/g, "");
}

function sqlString(value) {
  return "'" + String(value ?? "").replace(/'/g, "''") + "'";
}

function rowOf(result, tableName) {
  if (!Array.isArray(result) || result.length === 0) {
    return null;
  }
  return result[0][tableName] || result[0];
}

function rowsOf(result, tableName) {
  if (!Array.isArray(result)) {
    return [];
  }
  return result.map((item) => item[tableName] || item);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isTruthy(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function insertedRowId(inserted) {
  if (!inserted) {
    return "";
  }
  if (Array.isArray(inserted)) {
    return insertedRowId(inserted[0]);
  }
  if (inserted.ROWID || inserted.rowid) {
    return String(inserted.ROWID || inserted.rowid);
  }
  const nested = Object.values(inserted).find(
    (value) => value && typeof value === "object" && (value.ROWID || value.rowid)
  );
  return nested ? String(nested.ROWID || nested.rowid) : "";
}

function sendOk(res, data) {
  res.status(200).json({ ok: true, data });
}

function sendError(res, error) {
  const status = error.status || 500;
  if (status >= 500) {
    console.error("[api]", error);
  }
  const body = {
    ok: false,
    error:
      status >= 500
        ? "Something went wrong. Please try again."
        : error.message || "Unexpected error",
  };
  if (error.code) {
    body.code = error.code;
  }
  if (error.details && status < 500) {
    body.details = error.details;
  }
  res.status(status).json(body);
}

module.exports = {
  asId,
  asQty,
  asText,
  optionalText,
  sqlString,
  rowOf,
  rowsOf,
  num,
  isTruthy,
  insertedRowId,
  sendOk,
  sendError,
};
