# Inbox documentation

Inbox is a self-hosted email client that runs on Cloudflare Workers. Mail comes in through **Cloudflare Email Routing**, goes out through **any SMTP relay you choose** (SMTP2GO, Mailgun, Postmark, Amazon SES, …), and each person signs in with **Cloudflare Access** and sees only their own mailbox.

| Guide | What it covers |
| --- | --- |
| [Setup](./setup.md) | Prerequisites, installing with Bun, running locally |
| [Configuration](./configuration.md) | Every variable and secret, with examples |
| [SMTP sending](./smtp.md) | Configuring SMTP2GO (and other relays), DNS, limits |
| [Members](./members.md) | **Start here for teams**: add and remove people with Email Routing rules only |
| [Authentication & mailbox access](./authentication.md) | Cloudflare Access, how users are mapped to mailboxes |
| [Deployment](./deployment.md) | Step-by-step production deploy, upgrading, rollback |
| [Using the inbox](./usage.md) | End-user guide: reading, composing, folders, search |
| [Architecture](./architecture.md) | How the pieces fit together, API reference |
| [Troubleshooting](./troubleshooting.md) | Common errors and fixes |

## Quick start

```bash
bun install
cp .dev.vars.example .dev.vars   # then edit it
bun run dev
```

Open the URL printed by the dev server. Read [Setup](./setup.md) first if this is a fresh machine.
