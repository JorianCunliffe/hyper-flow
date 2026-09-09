# HyperFlow managed files

HyperFlow owns file bytes, visibility, upload progress and cleanup receipts. Communications owns its existing recordings and source data separately. This API does not erase Communications recordings, provider copies or backups.

## Access and operations

`/api/files` is available in Express and Vercel. Firebase members use their current organization; API credentials additionally need `files:read` or `files:write`. The request body cannot choose a tenant. Private files are visible to their author. Organization files are visible to current members. Administrators can cancel an unfinished private file by its recorded identity without receiving its filename or contents. The author or an administrator can delete an organization file. Each deletion records the responsible actor.

| Request | Contract |
|---|---|
| GET, optional `after` and `limit` | Bounded file page, default25, maximum100. `next` continues even when a page contains only invisible private files. |
| GET `id` | Current visible metadata and upload progress. Session credentials and bucket paths are omitted. |
| GET `id` and `download=1` | A ready file's generation-specific read link, expiring after60 seconds. A previously issued link can work until expiry; downloaded copies cannot be recalled. |
| POST `operation=start` | Stable `id` (8–100 letters/digits/underscore/hyphen), `name`, `mime`, `bytes`, base64 `crc32c`, `visibility` (`private` or `organization`). Same identity and descriptor replays the existing file. |
| POST `operation=chunk` | `id`, zero-based `offset`, base64 `content`. Chunks are1MiB except the final chunk. The offset aligns to1MiB. Changed bytes at an existing offset are rejected. |
| POST `operation=reconcile` | `id`. Reads authoritative provider progress and verifies a completed object's size, checksum and generation before releasing the upload lease. Does not manufacture success after an uncertain response. |
| POST `operation=delete` | `id`. Cancels the upload session, removes the generation observed in storage and verifies absence. Failure keeps a pending receipt/lease. Repeating the same identity reconciles it. |

Files contain1 byte to256MiB. Each REST chunk fits within the hosted request limit. The browser computes CRC32C incrementally; storage validates it, and HyperFlow checks the completed object's checksum again. Chunk request identities use SHA-256 to reject changed retries. These are integrity checks, not malware scanning.

The browser uploader, recordings, generated report attachments and public Ask uploads use these controls. Files attached to shared project work are organization-visible; the Files page defaults to private. Existing legacy URLs are still rendered as existing links; they are not silently imported into this registry. Public Ask uploads retain their own token authorization and validation, accept at most three files of2MiB each, and cap their combined encoded payload at3.8MB. They become organization-visible attachments with authenticated HyperFlow links.

Use `/?files=1` for the file manager or `/?file=<id>` for a stable authenticated file page. Re-select the original file to resume a pending upload after a reload; its identity, name, media type, size, visibility and checksum must match. The browser does not automatically retry uncertain writes. Account changes stop subsequent chunks. The standalone client exposes page, detail, download and operation methods.

## Recovery and retention

An upload is admitted through an atomic lifecycle lease before storage initialization. At most25 unresolved file operations are admitted per tenant. Leases do not expire automatically. Normal account suspension refuses to proceed while a lease remains. A crash before manifest creation leaves a visible recovery entry; administrator cancellation persists a tombstone before releasing it, preventing a delayed initializer from recreating the file. Empty upload sessions from a losing initializer are never given bytes or exposed to the client.

Storage session URLs stay server-side. File manifests pin the bucket used at creation, so later configuration changes cannot redirect cleanup or downloads to another bucket. Provider cleanup is conditional on the observed generation. Signed download links are short-lived; no public Firebase download token is created.

Human administrator POST `/api/tenant?view=lifecycle` with `operation=erase_managed_files`, stable `requestId`, current `revision`, `confirmation="Erase HyperFlow stored files"`, and `backupReviewed=true` removes managed objects while HyperFlow is suspended or database-erased. Retain and check needed files before suspension. Each request processes at most25 manifest entries, records progress, and keeps other lifecycle changes blocked until completion. Retry the original request. Unknown legacy manifests require operator review. File metadata receipts, provider soft-deleted versions, object versions, backups and previously downloaded copies are retained. This is not a whole-account or backup-erasure guarantee.

Automatic file retention is not enabled. No retention period or backup destruction has been inferred from the implementation request.

## Activation runbook — not yet authorized or performed

Production inspection found Firebase Storage unprovisioned on the Spark plan for project `hyper-flow-a459b`. Provisioning the default bucket requires a paid-plan decision. Do not upgrade billing or enable `HYPERFLOW_MANAGED_FILES` without the user's approval. The prepared code and configuration can be reviewed and tested while disabled.

1. Obtain approval for the Firebase billing-plan change and identify its billing account. Review current database usage as the project-wide billing change affects more than Storage. Agree a storage location before creating an immutable bucket location; Australia is a candidate, not an already-selected deployment region.
2. Create the intended private bucket. Require uniform bucket-level access and public-access prevention. Grant the existing HyperFlow server service account only the needed bucket object access. Inventory any pre-existing objects and provider soft-delete/version/retention settings; do not assume those copies are erased by API deletion.
3. Deploy `storage.rules` with the separate `firebase.storage.json` configuration. It denies browser SDK reads/writes. Read back the deployed rules and verify anonymous and Firebase-user direct object access are denied. These rules do not replace bucket IAM.
4. Set server-only `FIREBASE_STORAGE_BUCKET` to the verified bucket and `HYPERFLOW_MANAGED_FILES=true`; keep `FIREBASE_ENFORCE_TENANT_LIFECYCLE=true`. Redeploy HyperFlow. Do not put these credentials or any upload URI in client configuration or logs.
5. In an isolated test tenant, upload a multi-chunk recording and a small document, interrupt a response, reconcile, download and compare checksums. Test private-file denial for another member and another tenant. Cancel an upload, then freeze/export/clean up the fixture and verify provider object absence and retained receipts. Confirm Ask attachments use authenticated links. Record exact deployment and bucket settings.
6. Rollback must preserve normal database guards and all upload receipts. Do not re-enable legacy direct browser Storage writes. If uploads are pending, reconcile or cancel them before disabling the managed-file controller; otherwise the account correctly remains unable to suspend.

Protocol references: [Google resumable uploads](https://docs.cloud.google.com/storage/docs/performing-resumable-uploads) and [checksum validation](https://docs.cloud.google.com/storage/docs/data-validation). Local provider simulations validate application recovery logic; they do not prove live bucket IAM, signing or provider behavior.
