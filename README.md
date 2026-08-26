# Baylen App

Baylen is a Flutter mobile app with a Zoho Catalyst backend for beauty
e-commerce, salon booking, at-home services, FSM tracking, notifications,
payments, and admin data management.

## Current Stack

- Mobile app: Flutter
- Backend: Zoho Catalyst Serverless Advanced I/O function `baylen-api`
- Runtime: Node 20, Express, `zcatalyst-sdk-node`
- Database: Zoho Catalyst Data Store
- Media: Zoho Catalyst File Store
- API routing: Zoho Catalyst API Gateway
- Auth: Catalyst hosted login plus Baylen session token

## Catalyst Project

- Project: `Baylen-App`
- Project ID: `36851000000230006`
- Environment: `Development`
- Development domain: `baylen-app-60069781151.development`

## Important Paths

- Flutter app: `lib/`
- Catalyst backend: `backend/functions/baylen-api/`
- API Gateway rules: `backend/catalyst-user-rules.json`
- Data model: `docs/catalyst-data-model.md`
- Catalyst setup checklist: `docs/catalyst-console-configuration.md`
- Function env template: `backend/functions/baylen-api/.env.example`

## Local Validation

Backend syntax:

```powershell
Get-ChildItem backend\functions\baylen-api\routes\*.js | ForEach-Object { node --check $_.FullName }
node --check backend\functions\baylen-api\index.js
```

API Gateway JSON:

```powershell
node -e "JSON.parse(require('fs').readFileSync('backend/catalyst-user-rules.json','utf8')); console.log('api gateway json ok')"
```

Flutter:

```powershell
flutter analyze
```

Note: on this machine, Flutter/Dart commands currently start but hang without
output. Backend validation is working.

## Deployment Sequence

1. Configure Data Store tables in Catalyst.
2. Add function environment variables in Catalyst.
3. Deploy `baylen-api`.
4. Deploy API Gateway rules.
5. Test guest APIs, signed-in APIs, admin APIs, and provider APIs.

See `docs/catalyst-console-configuration.md` for the full setup checklist.
