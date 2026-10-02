# Documents module

`apps/server/src/modules/documents` · `common/storage` · `common/files/file-validation.ts`

## Purpose
Employee documents (ID proofs, contracts, certificates) with expiry tracking.

## Data
`Document`: `title`, `type` (`ID | CONTRACT | POLICY | CERTIFICATE | OTHER`), `storageKey`,
`mimeType`, `sizeBytes`, `uploadedById`, `expiryDate`.

## Endpoints

| Method & path | Access | Plan |
| --- | --- | --- |
| `GET /documents/me` | user | BASIC |
| `GET /documents?employeeId` | `documents.team.read`; `documents.manage` can see all | BASIC |
| `GET /documents/expiring?days=30` | `documents.manage` | BASIC |
| `POST /documents/upload` (multipart) | user; `employeeId` field requires `documents.manage` | BASIC |
| `GET /documents/:id/download` | owner or `documents.manage` | BASIC |
| `DELETE /documents/:id` | owner or `documents.manage` | BASIC |

## Rules
* **Content sniffing:** only PDF / PNG / JPEG accepted, identified by **magic bytes**
  (`%PDF-`, PNG signature, JPEG SOI). The filename and `Content-Type` are attacker-controlled
  and ignored. Max 10 MB (enforced by the multipart parser *and* after buffering).
* **Private storage:** S3 key `tenants/<tenantId>/documents/<employeeId>/<uuid>.<ext>`,
  server-side encrypted. The DB never stores a public URL; downloads stream through the API
  after the authorisation check. The bucket policy denies non-TLS access; versioning protects
  against accidental deletion.
* Other tenants' ids return 404.
* Deleting removes the DB row, then the object (a storage failure is logged — an orphaned
  object is preferable to failing the user's request).

## Tests
Security suite: exe renamed to `.pdf` rejected; upload → download bytes; other tenant 404.

## Why not pre-signed URLs?
Streaming through the API keeps one authorisation path and audit trail. Pre-signed GET URLs
(short TTL) are an optimisation for large files if bandwidth becomes a concern.
