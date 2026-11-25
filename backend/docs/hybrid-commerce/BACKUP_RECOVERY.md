# Backup and Recovery (Phase 5 Production)

Production-grade encrypted Catalyst Data Store backups for Baylen hybrid commerce.

**Important:** Production deployment MUST NOT proceed until the first verified encrypted backup/recovery point exists in WorkDrive. Development backups are test backups only.

---

## 1. Architecture

```
Catalyst Data Store (explicit --env)
        │
        ▼
Paginated export (ZCQL/CLI, no LIMIT 50000 truncation)
        │
        ▼
In-memory JSON payload + manifest (SHA-256)
        │
        ▼
AES-256-GCM encryption (.baylen-backup) — BACKUP_ENCRYPTION_KEY
        │
        ▼
WorkDrive upload (encrypted artifact only) — Catalyst WorkDrive Connection
        │
        ▼
Recovery verification (decrypt + manifest + row counts)
```

- **Local CLI:** export, encrypt, verify (`backend/scripts/backup-datastore.js`)
- **WorkDrive upload from CLI:** **not supported** — Catalyst Connections are function-runtime only
- **WorkDrive MCP (Cursor):** operator tooling only — **not** the production runtime integration
- **Production runtime integration:** Catalyst **WorkDrive Connector** via `app.connections().getConnectionCredentials(WORKDRIVE_CONNECTION_NAME)`

---

## 2. Data scope

Tables are classified in `backend/functions/baylen-api/lib/backup-table-scope.js`.

| Tier | Description |
|------|-------------|
| **PRODUCTION_CRITICAL** | Commerce, inventory, orders, salon, at-home beauty, users, serviceability, audit |
| **OPERATIONAL** | Notifications, OTP challenges, banners, media, nav |
| **OPTIONAL** | Search index (rebuildable), unprovisioned legacy tables |

**Export rules:**

- All **PRODUCTION_CRITICAL** + **OPERATIONAL** tables are included by default.
- **OPTIONAL** tables are included when present in the target environment.
- Missing **PRODUCTION_CRITICAL** tables → **fail closed**.
- Missing **OPTIONAL** tables → skipped (listed in `export_metadata.skipped_optional_tables`).
- Row export uses **paged reads** (300-row ZCQL pages / 200-row SDK pages) — no silent 50k truncation.

**Not in codebase (excluded):** legacy tables with no repo references remain out of scope unless added to `backup-table-scope.js`.

---

## 3. Environment targeting

`--env` is **mandatory**. There is **no default** environment.

```bash
node backend/scripts/backup-datastore.js --env Development --mode full --frequency daily
node backend/scripts/backup-datastore.js --env Production --mode full --frequency daily
```

**Fail-closed guards:**

- Invalid env values rejected
- Unprovisioned Production env rejected (when absent from `.catalystrc`)
- CLI active env must match requested env (`catalyst env:use Development|Production`)
- Export uses explicit Catalyst CLI `Environment` header for the requested env

---

## 4. Encryption model

| Item | Value |
|------|--------|
| Algorithm | **AES-256-GCM** |
| Key | `BACKUP_ENCRYPTION_KEY` (32 bytes — 64-char hex or base64) |
| IV/nonce | Random 12 bytes per backup |
| Auth | GCM auth tag (tamper detection) |
| Artifact | `.baylen-backup` JSON envelope |

**Envelope fields (unencrypted metadata):** `version`, `algorithm`, `iv`, `authTag`, `environment`, `createdAt`, `projectId`, `backupId`, `frequency`, `encryptedPayload`

**Inside encrypted payload:** manifest, export metadata, table JSON

**Never uploaded / never committed:** plaintext JSON, encryption keys, OAuth tokens

**Temporary plaintext:** in-memory only during export→encrypt; optional `--out` writes **encrypted** artifact only in encrypt/full modes.

---

## 5. WorkDrive folder map

| Tier | Folder | Folder ID |
|------|--------|-----------|
| Root | Baylen-App Production Backups | `ran7h35ae0de5cae3440488023bda9a8cb4cf` |
| Daily | Daily | `ran7hb08ff45f5ee540788a4fa8da84eaa208` |
| Weekly | Weekly | `ran7ha2bc8446c09e4909ac8ba57c339e8678` |
| Monthly | Monthly | `ran7h9f831d8f6bd147149451e12e1cd9e4b2` |
| Recovery drill | Recovery-Test | `ran7h03f9877c24f74c859a8602da9e6dd08c` |

Location: WorkDrive IN DC, My Folders. **Upload to tier folders only** — not the root folder.

**File naming:**

`baylen-app-{environment}-{frequency}-{UTC-timestamp}-{backup-id}.baylen-backup`

No overwrite — duplicate names receive a new suffix.

---

## 6. Catalyst WorkDrive Connection setup

**Status (Development): CONFIGURED**

| Field | Value |
|-------|--------|
| **Connection name** | `zoho_workdrive_connection` |
| **Connection link name** | `zohodrive` ← use this in code / env |
| **Service** | Work Drive |
| **Status** | Connected |
| **User access** | No (service account style) |

Set in function env:

```env
WORKDRIVE_CONNECTION_NAME=zohodrive
```

**Required scopes for backup upload:**

- `WorkDrive.files.CREATE` — upload encrypted artifacts
- `WorkDrive.files.READ` — download for recovery verify

Confirm `WorkDrive.files.CREATE` is enabled (check **Show More** on the Connections row if not visible).

**Verify in function runtime** (not local CLI):

```javascript
const creds = await app.connections().getConnectionCredentials("zohodrive");
```

**Local CLI upload:** still blocked — Connections API is unavailable outside Catalyst function handlers. Use `--mode export|encrypt|verify` locally; upload via the protected admin endpoint or future Cron job inside Catalyst runtime.

---

## 6a. Runtime WorkDrive upload (admin endpoint)

WorkDrive uploads execute **only inside the Catalyst `baylen-api` function runtime** using the Catalyst Connection link name **`zohodrive`**.

| Item | Value |
|------|--------|
| Endpoint | `POST /v1/admin/backup/upload` |
| Auth | `x-baylen-admin-key: <ADMIN_API_KEY>` (admin only — no customer auth) |
| Accepts | Encrypted `.baylen-backup` artifact only |
| Rejects | Plaintext JSON exports, invalid envelopes, env/frequency mismatch |
| Overwrite | Never — duplicate filenames get a new unique suffix |

**JSON body:**

```json
{
  "environment": "Development",
  "frequency": "daily",
  "artifact_base64": "<base64-encoded .baylen-backup>"
}
```

**Raw body alternative:** `Content-Type: application/octet-stream` with query `?environment=Development&frequency=daily`.

**Supported frequencies:** `daily`, `weekly`, `monthly`, `recovery-test`

**Pre-upload verification (in function):**

1. Artifact parses as encrypted `.baylen-backup` envelope
2. Manifest decrypts with `BACKUP_ENCRYPTION_KEY` (in-memory only — never logged)
3. Environment and frequency match request
4. SHA-256 integrity (`encrypted_artifact_sha256`, `payload_sha256`) valid
5. WorkDrive upload uses `parent_id` from configured tier folder (not root)

**Response (safe metadata only):**

```json
{
  "upload": {
    "ok": true,
    "backup_id": "...",
    "environment": "Development",
    "frequency": "daily",
    "folder_id": "...",
    "file_name": "baylen-app-development-daily-....baylen-backup",
    "workdrive_resource_id": "...",
    "uploaded_at": "...",
    "total_rows": 1694,
    "duplicate_renamed": false,
    "production_mutated": false
  }
}
```

**Security:** Never log customer records, encryption keys, OAuth tokens, or decrypted payload. Never accept plaintext backup content.

**Manual upload verification procedure:**

1. Export + encrypt locally: `node backend/scripts/backup-datastore.js --env Development --mode encrypt --frequency daily --out backend/backups/dev-upload-test`
2. Confirm `--mode verify` PASS on the artifact
3. `POST /v1/admin/backup/upload` with admin key (Development deployment only)
4. Confirm WorkDrive file in **Daily/** folder with `.baylen-backup` extension
5. Download via WorkDrive; confirm file is not plaintext JSON
6. Run local `--mode verify` on downloaded artifact; confirm row counts match export baseline
7. Confirm Catalyst Data Store row counts unchanged (no restore/mutation)

---

## 7. Required environment variables

Set in operator shell or Catalyst function env (Production). **Never commit values.**

```env
# Required for encrypt / full / verify
BACKUP_ENCRYPTION_KEY=<64-char hex or base64 32-byte key>
# Optional: read key from file (local ops)
BACKUP_ENCRYPTION_KEY_FILE=/secure/path/backup.key

# WorkDrive (function runtime upload)
WORKDRIVE_CONNECTION_NAME=zohodrive
BACKUP_WORKDRIVE_API_BASE=https://workdrive.zoho.in/api/v1
BACKUP_WORKDRIVE_DOWNLOAD_BASE=https://workdrive.zoho.in/download
BACKUP_WORKDRIVE_DAILY_FOLDER_ID=ran7hb08ff45f5ee540788a4fa8da84eaa208
BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID=ran7ha2bc8446c09e4909ac8ba57c339e8678
BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID=ran7h9f831d8f6bd147149451e12e1cd9e4b2
BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID=ran7h03f9877c24f74c859a8602da9e6dd08c

# Optional override
BAYLEN_BACKUP_PROJECT_ID=36851000000230006
```

---

## 8. Commands

From repo root (Catalyst CLI logged in, correct `catalyst env:use`):

```bash
# Export metadata + row counts only (no encryption)
node backend/scripts/backup-datastore.js --env Development --mode export --frequency daily

# Export + encrypt + self-verify
node backend/scripts/backup-datastore.js --env Development --mode encrypt --frequency daily --out backend/backups/dev-encrypt

# Verify existing artifact
node backend/scripts/backup-datastore.js --env Development --mode verify --frequency daily --artifact backend/backups/dev-encrypt/<file>.baylen-backup

# Full pipeline (export + encrypt + verify locally; upload via admin endpoint)
node backend/scripts/backup-datastore.js --env Development --mode full --frequency daily --out backend/backups/dev-full

# Upload encrypted artifact (Development function runtime only)
curl -X POST "$BAYLEN_API/v1/admin/backup/upload" \
  -H "x-baylen-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"environment":"Development","frequency":"daily","artifact_base64":"'"$(base64 -w0 backend/backups/dev-full/*.baylen-backup)"'"}'
```

**Legacy script:** `export-datastore-snapshot.js` now requires `--env` and delegates to `backup-datastore.js`.

---

## 9. Daily backup procedure

1. Confirm Catalyst CLI active env matches target (`catalyst env:use Development|Production`).
2. Run `--mode encrypt` or `--mode full` with `--frequency daily`.
3. Confirm log: `encrypt.verify: pass`, `totalRows` > 0.
4. Upload encrypted `.baylen-backup` via `POST /v1/admin/backup/upload` (Development function runtime).
5. Confirm no plaintext JSON in WorkDrive or Git.
6. Record backup ID + manifest row counts in ops log.

---

## 10. Weekly backup procedure

Same as daily with `--frequency weekly` → WorkDrive **Weekly/**.

Copy Sunday daily artifact if weekly job is manual.

---

## 11. Monthly backup procedure

Run first day of month with `--frequency monthly` → WorkDrive **Monthly/**.

Retain 12 monthly artifacts minimum.

---

## 12. Recovery-Test procedure

1. Run `--frequency recovery-test` encrypt/full.
2. Upload to **Recovery-Test/** folder.
3. Download artifact via WorkDrive API (function runtime).
4. Run `--mode verify` locally with same `BACKUP_ENCRYPTION_KEY`.
5. Confirm manifest row counts match export baseline.
6. **Never** restore into Production automatically during recovery test.

---

## 13. Restore procedure

See prior runbook ordering (warehouses → catalog → inventory → users → orders). Restore from **decrypted** payload after verify. Prefer Development drills.

---

## 14. Retention

| Tier | Retention |
|------|-----------|
| Daily | 7 days |
| Weekly | 4 weeks |
| Monthly | 12 months |

Purge older artifacts only after a newer monthly backup is verified.

---

## 15. Access control

- Platform Administrator + System Administrator only
- No public WorkDrive links
- Encryption key in secure vault (not Catalyst env plaintext logs)

---

## 16. Backup ownership

| Activity | Role |
|----------|------|
| Backup execution | Platform Administrator |
| Encryption key custody | System Administrator |
| WorkDrive folder access | System Administrator |
| Recovery testing | Platform Administrator |
| Production go-live sign-off | System Administrator |

---

## 17. Failure handling

| Failure | Action |
|---------|--------|
| `ENV_REQUIRED` / `ENV_NOT_PROVISIONED` | Fix `--env`; provision Production env |
| `ENV_TARGET_MISMATCH` | `catalyst env:use <env>` |
| `TABLES_MISSING` | Provision missing tables or fix scope |
| `BACKUP_KEY_MISSING` | Set `BACKUP_ENCRYPTION_KEY` |
| `WORKDRIVE_CONNECTION_CLI_UNSUPPORTED` | Expected locally — use function runtime |
| `WORKDRIVE_CONNECTION_MISSING` | Complete Console Connection setup |
| `WORKDRIVE_DUPLICATE` | Retry — pipeline appends unique suffix |

---

## 18. Incident handling

1. Identify last verified **Monthly** or **Daily** artifact in WorkDrive.
2. Download encrypted artifact.
3. Verify decrypt + manifest locally.
4. Restore in approved window (Development first).
5. Document incident with backup ID and operator.

---

## 19. Production go-live prerequisite

Before Production deploy:

1. Production Catalyst environment provisioned
2. Unique Production secrets set
3. WorkDrive Connection authorized with `WorkDrive.files.CREATE`
4. Tier folder IDs configured in Production env
5. First **Production** encrypted backup uploaded to Daily/
6. Recovery-Test verify PASS on that artifact

---

## Related files

- `backend/scripts/backup-datastore.js` — CLI entry
- `backend/functions/baylen-api/lib/backup-*.js` — pipeline modules
- `backend/functions/baylen-api/lib/backup-upload.js` — runtime upload validation + WorkDrive orchestration
- `backend/functions/baylen-api/routes/admin.js` — `POST /v1/admin/backup/upload`
- `backend/functions/baylen-api/test/backup.test.js` — backup security tests
- `backend/functions/baylen-api/test/backup-upload.test.js` — WorkDrive upload tests
- `backend/functions/baylen-api/lib/backup-table-scope.js` — table tiers
