const { isTruthy } = require("./http");

async function fetchAllTableRows(app, tableName) {
  const table = app.datastore().table(tableName);
  const rows = [];
  let nextToken;
  do {
    const page = await table.getPagedRows({ nextToken, maxRows: 200 });
    const data = Array.isArray(page?.data) ? page.data : [];
    rows.push(...data);
    nextToken = page?.more_records ? page.next_token : undefined;
  } while (nextToken);
  return rows;
}

function activeRows(rows) {
  return (rows || []).filter((row) => isTruthy(row.is_active) || row.is_active === undefined);
}

module.exports = { fetchAllTableRows, activeRows };
