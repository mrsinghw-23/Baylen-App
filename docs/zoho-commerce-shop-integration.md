# Baylen Shop - Zoho Commerce Integration

Baylen Shop can read live products from Zoho Commerce through the Catalyst backend.
Flutter must never call Zoho Commerce directly because OAuth credentials must stay on the server.

## Catalyst Environment Variables

Configure these in Catalyst for `baylen-api`:

```text
ZOHO_COMMERCE_ENABLED=true
ZOHO_COMMERCE_CONNECTION_LINK_NAME=zoho_commerce_connection
ZOHO_COMMERCE_ORGANIZATION_ID=<your Zoho Commerce store organization id>
ZOHO_COMMERCE_API_BASE=https://commerce.zoho.com
ZOHO_COMMERCE_STOREFRONT_DOMAIN=www.baylende.com
ZOHO_COMMERCE_MAX_PAGES=5
```

Use the regional Zoho Accounts/API base if your Commerce account is not on `.com`.

Because Baylen uses a Catalyst Connection, you do not need to store
`ZOHO_COMMERCE_CLIENT_ID`, `ZOHO_COMMERCE_CLIENT_SECRET`, or
`ZOHO_COMMERCE_REFRESH_TOKEN` in the function environment.

## Data Flow

```text
Flutter Shop
-> Catalyst /v1/catalog/products
-> Catalyst Connector gets Zoho OAuth access token
-> Zoho Commerce Products API
-> Catalyst maps products and storefront image URLs to Baylen catalog shape
-> Flutter renders Shop cards and Product Details
```

## Current Behavior

- If `ZOHO_COMMERCE_ENABLED=false`, Shop continues using Catalyst Data Store products.
- If enabled and credentials are valid, `/v1/catalog/products` returns Zoho Commerce products.
- Commerce products are browseable in Shop and Product Detail.
- Add to Cart for Commerce-only products is blocked until Zoho Commerce checkout/cart sync is configured.

## Required Zoho Scope

```text
ZohoCommerce.items.READ
```
