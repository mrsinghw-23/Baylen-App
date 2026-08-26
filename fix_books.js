const fs = require('fs');
const file = 'backend/functions/baylen-api/lib/zoho-books.js';
let content = fs.readFileSync(file, 'utf8');

const newFetch = \sync function fetchBooksItems(req, config = booksConfig()) {
  let token = '';
  try {
    const creds = await req.catalystApp.connections().getConnectionCredentials('zoho_books');
    if (creds && creds.headers && creds.headers.Authorization) {
      token = creds.headers.Authorization;
      if (!token.startsWith('Zoho-oauthtoken')) token = 'Zoho-oauthtoken ' + token.replace(/^Bearer\s+/i, '');
    } else if (creds && creds.parameters && creds.parameters.access_token) {
      token = 'Zoho-oauthtoken ' + creds.parameters.access_token;
    }
  } catch (err) {
    console.log('Connection credentials error:', err.message);
  }

  if (!token) {
    if (!isBooksConfigured(config)) {
      throw new Error('Zoho Books is not configured in environment and Catalyst Connection failed.');
    }
    const rawToken = await getBooksAccessToken(config);
    token = 'Zoho-oauthtoken ' + rawToken;
  }

  let page = 1;
  let hasMore = true;
  const allItems = [];

  while (hasMore && page <= 10) {
    const url = \\\\/items?organization_id=\&page=\&per_page=200&status=active\\\;
    const response = await fetch(url, {
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new Error(\\\Zoho Books API error: \\\\);
    }

    const items = data.items || [];
    allItems.push(...items);
    hasMore = data.page_context?.has_more_page === true;
    page += 1;
  }

  return allItems;
}\;

content = content.replace(/async function fetchBooksItems[\\s\\S]*?return allItems;\\s*\\}/, newFetch);
content = content.replace(/const items = await fetchBooksItems\\(\\);/, 'const items = await fetchBooksItems(req);');
fs.writeFileSync(file, content);
console.log('Updated zoho-books.js fetchBooksItems');
