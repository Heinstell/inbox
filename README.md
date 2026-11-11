<div align="center">
  <h1>Inbox</h1>
  <p><em>A self-hosted, per-user email inbox running on Cloudflare Workers, sending through your own SMTP relay</em></p>
</div>

Inbox lets your team send, receive and manage email for your domain through a web interface, all running in your own Cloudflare account:

- **Receiving** through [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- **Sending** through any SMTP relay, e.g. [SMTP2GO](https://www.smtp2go.com), Mailgun, Postmark or Amazon SES
- **Sign-in** with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). Each person sees **only their own mailbox**.
- **Storage**: one [Durable Object](https://developers.cloudflare.com/durable-objects/) with SQLite per mailbox, and attachments in [R2](https://developers.cloudflare.com/r2/)

Forked from [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox), with the AI agent and MCP server removed.

## Quick start

```bash
bun install
cp .dev.vars.example .dev.vars   # set DEV_USER_EMAIL and your SMTP credentials
bun run dev
```

Deploying to production:

```bash
bunx wrangler r2 bucket create agentic-inbox
bunx wrangler secret put SMTP_USERNAME
bunx wrangler secret put SMTP_PASSWORD
bun run deploy
# then enable Cloudflare Access, set POLICY_AUD / TEAM_DOMAIN,
# and route your domain's email to the Worker
```

## Documentation

Everything is in [`docs/`](./docs/README.md):

- [Setup](./docs/setup.md): prerequisites, Bun, local development
- [Configuration](./docs/configuration.md): all variables and secrets
- [SMTP sending](./docs/smtp.md): SMTP2GO and other relays, DNS
- [Members](./docs/members.md): add and remove people with Email Routing rules only
- [Authentication & mailbox access](./docs/authentication.md): Cloudflare Access, per-user mailboxes
- [Deployment](./docs/deployment.md): production deploy, upgrading, rollback
- [Using the inbox](./docs/usage.md): end-user guide
- [Architecture](./docs/architecture.md): design and API reference
- [Troubleshooting](./docs/troubleshooting.md)

## Features

- Rich-text composer, reply / reply-all / forward with correct threading headers
- Conversations, folders, stars, archive, trash, drafts
- Search with filters (`from:`, `is:unread`, `has:attachment`, `before:` …)
- Per-user mailboxes, managed with your Email Routing forwarding rules: no member config in the app
- Incoming mail is kept in the inbox **and** forwarded to each member's personal address
- Synchronous SMTP delivery: failures are shown to the user, never silently dropped

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TanStack Query, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing, TCP sockets (SMTP)
- **Auth:** Cloudflare Access JWT validation, with per-user mailbox authorization
- **Tooling:** Bun (package manager, scripts, tests). Wrangler and Miniflare still need Node.js installed.

## License

Apache 2.0, see [LICENSE](LICENSE).
