# Privacy & compliance (GDPR / India DPDP Act 2023)

`apps/server/src/modules/compliance`

| Right | Endpoint | Behaviour |
| --- | --- | --- |
| Access / portability | `GET /gdpr/export` (any user, 3/hour) | JSON download of the profile, employee record, leave, attendance, salary structure, finalized payslips, document metadata, reviews and notifications. Audited |
| Erasure (employees) | `POST /gdpr/employees/:id/erase` (`employees.offboard`) | Only after offboarding. Replaces name/email/phone/code, disables the login, clears free-text (leave reasons, review comments), deletes documents (DB + S3), attendance, salary structure and notifications |
| Erasure (candidates) | `DELETE /gdpr/applications/:id` (`hiring.pipeline.manage`) | Deletes the application, resume file and related notifications |

**Retention exception:** payslips are kept (amounts only, linked to the anonymised record)
because tax and labour laws require payroll records for several years; erasure rights do not
override legal retention obligations. The response states what was retained.

Other controls that support compliance: consent capture on applications, audit trail,
encryption at rest (RDS, S3, secrets), TLS everywhere, least-privilege IAM, data processors
limited to AWS, Stripe, Google (Gemini/SSO), optional Slack and Sentry (no PII sent).

S3 versioning keeps deleted objects for 30 days (`noncurrent_version_expiration`), which bounds
how long an erased file can persist in backups.
