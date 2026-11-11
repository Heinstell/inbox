# Architecture

```
                   Cloudflare Access (SSO)
                            │  Cf-Access-Jwt-Assertion
┌──────────────┐     ┌──────▼───────────────┐     ┌──────────────────────────┐
│   Browser    │────>│  Worker (Hono)       │────>│  MailboxDO (one per      │
│  React SPA   │     │  workers/app.ts      │     │  mailbox, SQLite)        │
└──────────────┘     │   ├ Access JWT check │     └──────────────────────────┘
                     │   ├ per-user authz   │────>┌──────────────────────────┐
 Email Routing ─────>│   ├ /api/v1/*        │     │  R2: mailbox settings +  │
 (inbound mail)      │   └ React Router SSR │     │  attachments             │
                     └──────────┬───────────┘     └──────────────────────────┘
                                │ TCP socket (TLS / STARTTLS)
                                ▼
                       SMTP relay (SMTP2GO, …) ──> recipients
```

## Components

| Path | Responsibility |
| --- | --- |
| `workers/app.ts` | Worker entry: Access JWT validation, `fetch` handler (API + SSR), `email` handler |
| `workers/index.ts` | REST API routes and inbound email processing |
| `workers/lib/auth.ts` | Identity → mailbox mapping, inbound address policy, mailbox provisioning |
| `workers/lib/routing-directory.ts` | Reads Email Routing forwarding rules (Cloudflare API, 60 s cache) into the member directory |
| `workers/lib/mailbox.ts` | Middleware that authorizes and resolves the mailbox Durable Object |
| `workers/lib/outbound.ts` | Send pipeline: validate sender → rate limit → SMTP → store in Sent |
| `workers/lib/smtp.ts` | SMTP client over `cloudflare:sockets` |
| `workers/lib/mime.ts` | MIME message builder |
| `workers/email-sender.ts` | Reads SMTP config from env and sends a message |
| `workers/durableObject/` | `MailboxDO`: SQLite schema, migrations, queries (emails, threads, folders, search) |
| `app/` | React 19 + React Router v7 frontend (TanStack Query, Zustand, TipTap, `@cloudflare/kumo`) |
| `shared/` | Code shared by frontend and Worker (folders, dates) |
| `tests/` | Bun unit tests |

## Storage

- **R2 `mailboxes/<address>.json`**: mailbox settings (display name, …). Its existence means "the mailbox exists".
- **R2 `attachments/<emailId>/<attachmentId>/<filename>`**: attachment blobs, inbound and outbound.
- **Durable Object `MailboxDO`**, keyed by mailbox address: SQLite tables for emails, folders and attachment metadata, with full-text search.

## Inbound flow

1. Email Routing calls the Worker's `email` handler with the raw message and the envelope recipient.
2. The recipient is checked against `DOMAINS` / `EMAIL_ADDRESSES` / existing mailboxes / the Email Routing member directory / `MAILBOX_OWNERS`. Unknown recipients are rejected.
3. The message is parsed (`postal-mime`), attachments are written to R2, and the email is stored in the mailbox's Inbox with threading info (`In-Reply-To`, `References`, falling back to subject matching).
4. A copy is forwarded (`message.forward`) to each destination in the address's Email Routing rule ([Members](./members.md)). Forwarding failures are logged, not retried, so the message is never stored twice.

## Outbound flow

1. The browser calls `POST /api/v1/mailboxes/:id/emails` (or `/reply`, `/forward`).
2. The sender must equal the mailbox address, and the per-mailbox rate limit is checked.
3. A MIME message is built with a fresh `Message-ID` (and threading headers for replies) and delivered over SMTP.
4. Only after the relay accepts the message is it stored in Sent.

## API

All routes need an authenticated Access session. `:mailboxId` is the mailbox address and must belong to the caller.

| Method & path | Description |
| --- | --- |
| `GET /api/v1/me` | `{ email, mailboxes[] }` for the signed-in user |
| `GET /api/v1/config` | `{ domains[] }` |
| `GET /api/v1/mailboxes` | The caller's mailboxes (created on first call) |
| `GET/PUT /api/v1/mailboxes/:mailboxId` | Read / update mailbox settings |
| `GET /api/v1/mailboxes/:mailboxId/emails?folder=&page=&limit=&threaded=` | List emails |
| `POST /api/v1/mailboxes/:mailboxId/emails` | Send a new email |
| `GET/PUT/DELETE /api/v1/mailboxes/:mailboxId/emails/:id` | Read / update (`read`, `starred`) / delete |
| `POST /api/v1/mailboxes/:mailboxId/emails/:id/move` | `{ folderId }` |
| `POST /api/v1/mailboxes/:mailboxId/emails/:id/reply` | Reply (threaded) |
| `POST /api/v1/mailboxes/:mailboxId/emails/:id/forward` | Forward |
| `POST /api/v1/mailboxes/:mailboxId/drafts` | Save a draft |
| `GET /api/v1/mailboxes/:mailboxId/threads/:threadId` | All messages in a thread |
| `POST /api/v1/mailboxes/:mailboxId/threads/:threadId/read` | Mark thread read |
| `GET/POST /api/v1/mailboxes/:mailboxId/folders`, `PUT/DELETE …/folders/:id` | Folder management |
| `GET /api/v1/mailboxes/:mailboxId/search?query=…` | Search |
| `GET /api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId` | Download an attachment |

Send request body:

```json
{
  "from": { "email": "alice@example.com", "name": "Alice" },
  "to": ["bob@other.com"],
  "cc": "carol@other.com",
  "bcc": "dave@other.com",
  "subject": "Hello",
  "html": "<p>Hi Bob</p>",
  "attachments": [
    { "content": "<base64>", "filename": "a.pdf", "type": "application/pdf", "disposition": "attachment" }
  ]
}
```

Responses: `201` on success; `400` invalid sender; `429` rate limit; `502` the SMTP relay refused or couldn't be reached (the `error` field carries the relay's message); `500` SMTP misconfigured.
