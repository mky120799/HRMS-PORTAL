# Notifications and email

`apps/server/src/modules/notifications` · `apps/server/src/common/email` · `apps/server/src/common/messaging`

## Purpose

The notification module gives employees an in-app inbox and delivers email in
the background. It is being moved from direct email calls to a central,
transactional notification platform that can be reused by leave, hiring,
payroll, attendance and security.

The first production flow is implemented for a final leave decision:

```text
leave transaction
  ├─ updates the leave request and ledger
  ├─ creates NotificationEvent
  ├─ creates the employee's IN_APP Notification
  ├─ creates the queued EMAIL Notification
  └─ creates NotificationOutboxEvent
             │
             └─ after commit → RabbitMQ → EmailProcessor → AWS SES
```

If the leave transaction rolls back, none of these records survive. If
RabbitMQ is temporarily unavailable, the committed outbox row remains in
PostgreSQL and is retried later.

## Important terms

- **Notification event** — the business occurrence, such as
  `LEAVE_APPROVED`. It is independent of any delivery channel.
- **Channel** — how a recipient receives the message. The current channels are
  `IN_APP` and `EMAIL`.
- **Outbox** — a PostgreSQL record describing work that must be handed to
  RabbitMQ after the surrounding business transaction commits.
- **Worker** — a background consumer that performs delivery work.
- **Idempotency key** — a deterministic key that prevents a retry from creating
  a second logical notification.
- **Processing lease** — temporary ownership of an outbox or email record. A
  crashed worker's expired lease can be recovered by another application
  instance.

## Components

| Component                       | Responsibility                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `NotificationPublisherService`  | Writes the event, channel records and outbox work inside a caller-provided Prisma transaction.            |
| `NotificationOutboxProcessor`   | Leases committed outbox rows and publishes them to RabbitMQ with bounded retries.                         |
| `NotificationCampaignProcessor` | Expands due campaigns in batches and creates ordinary per-recipient notification events.                  |
| `NotificationOperationsService` | Reports tenant delivery health and safely requeues failed platform email.                                 |
| `NotificationRetentionService`  | Removes old final notification records on a schedule while preserving pending, failed and unread work.    |
| `RabbitMqService`               | Durable queue declaration, publisher confirms, consumer acknowledgements, retries and dead-letter queues. |
| `EmailProcessor`                | Claims queued email records and sends them through SES, or logs them in development.                      |
| `NotificationsService`          | Inbox queries, read/archive operations, preferences and guarded admin communication.                      |
| `NotificationsPage`             | Employee inbox and the administrator delivery log/composer.                                               |

## Data model

### `NotificationEvent`

One durable business event. `(tenantId, eventKey)` is unique, so retrying the
same operation reuses the same event.

Important fields:

- `eventType`: machine-readable name such as `LEAVE_APPROVED`
- `category`: UI grouping such as `LEAVE`
- `actorUserId`: user who caused the event, when applicable
- `data`: structured event data used for auditing and future channel rendering

### `Notification`

A channel-specific recipient record. Existing rows are preserved for backward
compatibility. New platform records link to `NotificationEvent` through
`eventId`.

- In-app state uses `readAt` and `archivedAt`.
- Email state uses `QUEUED`, `PROCESSING`, `SENT` and `FAILED`.
- `link` sends the employee to the relevant HRMS screen.
- `idempotencyKey` is unique within a tenant.

Inbox state and email delivery state remain in this table during the compatible
migration. A later migration may split channel delivery attempts into their own
table if provider callbacks or multiple providers require it.

### `NotificationOutboxEvent`

The durable PostgreSQL-to-RabbitMQ hand-off. The processor:

1. finds pending work or an expired processing lease;
2. atomically claims the row;
3. publishes a persistent RabbitMQ message and waits for broker confirmation;
4. marks the row completed;
5. retries failures with exponential backoff;
6. marks the outbox and email record failed after five attempts;
7. reports terminal failure to application monitoring.

Credential-bearing invite and password-reset payloads are never stored as
plain JSON. Their delivery payload is encrypted with AES-256-GCM, while the
ordinary `payload` column contains only the notification ID. The notification
log stores a redacted body. After the email provider accepts the message, the
email worker clears the encrypted outbox payload.

### `NotificationPreference`

A per-user opt-in or opt-out for an event type and channel. Missing preferences
mean enabled. A specific event preference overrides the wildcard (`*`)
preference. Mandatory security or compliance notifications will ignore
opt-outs when published with `mandatory: true`.

### `NotificationCampaign` and recipients

An administrator announcement is stored as a campaign before any recipient is
processed. The selected active employees are copied into recipient rows when
the campaign is created, so a later department or employment change does not
silently change the scheduled audience.

The campaign processor leases due campaigns and handles recipients in batches
of 100. Each recipient becomes an ordinary `COMPANY_ANNOUNCEMENT` event, so
preferences, idempotency and the email outbox work exactly as they do for leave
events. Failed recipient expansion is retried up to five times. A campaign can
be cancelled while it is still `SCHEDULED`.

## Retention

Notification cleanup is lifecycle-aware and runs inside the application. It
uses a PostgreSQL advisory lock, so multiple server instances can run without
all of them deleting the same records at once.

Default retention:

- user-visible notification history: 365 days;
- completed notification outbox rows: 30 days;
- cleanup interval: 24 hours.

The cleanup intentionally deletes only final, non-actionable records:

- completed outbox rows older than the completed-outbox retention window;
- sent email log rows older than the history retention window;
- read or archived in-app notifications older than the history retention
  window;
- completed or cancelled campaign records after their recipients are removed;
- orphaned notification events with no remaining channel or outbox records.

Unread in-app notifications, queued or processing email, failed email, pending
outbox rows and failed campaign recipient rows are preserved. Those records
represent user-visible work or operational problems that should be handled
before removal.

Retention can be changed with:

```bash
NOTIFICATION_HISTORY_RETENTION_DAYS=365
NOTIFICATION_COMPLETED_OUTBOX_RETENTION_DAYS=30
NOTIFICATION_RETENTION_CLEANUP_INTERVAL_HOURS=24
```

## Leave-decision example

`LeaveRequestService.review()` calls the publisher before its serializable
transaction completes:

```ts
await notifications.publish(tx, {
  tenantId,
  eventKey: `leave-decision:${leaveRequestId}:APPROVED`,
  eventType: "LEAVE_APPROVED",
  category: "LEAVE",
  recipients: [{ userId, email }],
  channels: ["IN_APP", "EMAIL"],
  title: "Leave request approved",
  body: "Your annual leave was approved.",
  link: "/leaves",
  email: renderedEmail,
  data: { leaveRequestId },
});
```

The publisher never contacts RabbitMQ. Network work inside a database
transaction could succeed even when the transaction later rolls back, which
would send a false notification. The outbox prevents that failure mode.

## API endpoints

| Method and path                            | Access           | Purpose                                                                                                                        |
| ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /notifications`                       | Authenticated    | `mine` returns the user's in-app inbox; administrator `all` returns the tenant delivery log. Supports `category` and `unread`. |
| `GET /notifications/unread-count`          | Authenticated    | Lightweight count for the navigation badge.                                                                                    |
| `PUT /notifications/:id/read`              | Recipient        | Marks one in-app notification read.                                                                                            |
| `POST /notifications/:id/read`             | Recipient        | Backward-compatible form of the same operation.                                                                                |
| `PUT /notifications/read-all`              | Recipient        | Marks every visible in-app notification read.                                                                                  |
| `PUT /notifications/:id/archive`           | Recipient        | Reads and removes an in-app item from the normal inbox.                                                                        |
| `GET /notifications/preferences`           | Authenticated    | Returns the current user's explicit preferences.                                                                               |
| `PUT /notifications/preferences`           | Authenticated    | Upserts one event/channel preference.                                                                                          |
| `POST /notifications/compose-email`        | ADMIN, 30/minute | Sends only to an active member of the same tenant.                                                                             |
| `POST /notifications/announce`             | ADMIN, 5/hour    | Compatibility endpoint that creates an immediate or scheduled campaign for up to 1,000 recipients.                             |
| `POST /notifications/campaigns`            | ADMIN, 20/hour   | Creates an immediate or scheduled announcement and snapshots its audience.                                                     |
| `GET /notifications/campaigns`             | ADMIN            | Lists the 50 most recent campaigns and their progress.                                                                         |
| `GET /notifications/campaigns/:id`         | ADMIN            | Returns campaign details and the first 100 recipient results.                                                                  |
| `POST /notifications/campaigns/:id/cancel` | ADMIN            | Cancels a campaign that has not started processing.                                                                            |
| `GET /notifications/operations`            | ADMIN            | Returns grouped delivery, outbox and campaign health plus recent failures.                                                     |
| `POST /notifications/deliveries/:id/retry` | ADMIN            | Safely requeues a failed platform email using its preserved outbox payload.                                                    |

## Email pipeline

```text
NotificationOutboxProcessor
  → RabbitMQ queue hrms.email
  → EmailProcessor claims Notification for five minutes
  → AWS SES SendEmail (production) or log driver (development)
  → Notification becomes SENT or FAILED
```

- RabbitMQ messages are persistent and publishing waits for broker confirms.
- Email processing allows five attempts with exponential backoff.
- A stale five-minute processing lease makes crash recovery possible.
- Deterministic notification keys make duplicate queue delivery harmless.
- Credential-bearing emails use `sensitive: true` on the legacy email API so
  their stored body is redacted.

## Security rules

- Every read and mutation includes the authenticated tenant ID.
- Employees can read, mark or archive only their own in-app notifications.
- Only administrators can view the tenant delivery log or compose messages.
- The compose endpoint accepts only active employees in the same workspace; it
  cannot be used as an open email relay.
- Rich text is reduced to an allow-list. Scripts, styles, iframes and event
  handlers are removed; links are restricted to HTTPS and `mailto`.
- Raw provider credentials and credential-bearing links are not written to
  application logs.

## Current scope and next work

Implemented in the platform path:

- Transactional event and outbox records
- In-app and email channels
- RabbitMQ delivery with leases, retries and terminal failure handling
- Per-user channel preferences
- Web controls for default in-app and email preferences
- Unread count, read-all, archive, category and deep-link support
- Final leave approval/rejection integration
- Immediate and scheduled announcement campaigns
- Audience snapshots, batch fan-out, progress and pre-send cancellation
- Administrator delivery-health summary and safe failed-email retry
- Web delivery-health cards for queued/failed email and outbox work
- Transactional leave approval reminders and escalations
- Transactional account invitations and password-reset requests
- Encrypted-at-rest credential email payloads with post-delivery cleanup
- Hiring candidate emails plus interviewer email/in-app notifications
- Scheduled retention cleanup for old final records

Still to be migrated or added:

- Add payroll and attendance notification events as those workflows are exposed
- Quiet hours and daily/weekly digests
- Real-time inbox updates using Server-Sent Events
- Versioned and tenant-customizable templates
- SES delivery, bounce and complaint webhooks
- Suppression lists and expanded provider monitoring

These items are intentionally listed as current work rather than described as
already available.

## Local development

- PostgreSQL stores events, notifications, preferences and outbox state.
- RabbitMQ must be available at `RABBITMQ_URL`.
- `EMAIL_DRIVER=log` prints the email instead of contacting SES.
- Production configuration requires `EMAIL_DRIVER=ses`.

Apply the Prisma migration before starting the updated server:

```bash
npm run db:deploy
```
