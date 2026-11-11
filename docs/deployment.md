# Deployment

This guide deploys Inbox to your Cloudflare account. It assumes you've done [Setup](./setup.md) (`bun install`, `bunx wrangler login`).

## 1. Configure `wrangler.jsonc`

Set at least `DOMAINS`, `SMTP_HOST`, `SMTP_PORT` and `SMTP_SECURE`. Decide whether you need `EMAIL_ADDRESSES` and `MAILBOX_OWNERS`. See [Configuration](./configuration.md).

## 2. Create the R2 bucket

```bash
bunx wrangler r2 bucket create agentic-inbox
```

(Use whatever name `bucket_name` has in `wrangler.jsonc`.)

## 3. Set up your SMTP relay

Verify your sending domain with your provider and create SMTP credentials. See [SMTP sending](./smtp.md). Then:

```bash
bunx wrangler secret put SMTP_USERNAME
bunx wrangler secret put SMTP_PASSWORD
```

If the Worker doesn't exist yet, `wrangler secret put` offers to create it. Accept.

## 4. Deploy

```bash
bun run deploy
```

Until Access is configured, every page returns *"Cloudflare Access must be configured in production"*. That's expected, because the app fails closed.

## 5. Enable Cloudflare Access

Follow [Authentication → Setting up Access](./authentication.md#setting-up-access). In short: enable Access on the Worker's route, save `POLICY_AUD` and `TEAM_DOMAIN` as secrets, restrict the policy, and add your identity provider.

```bash
bunx wrangler secret put POLICY_AUD
bunx wrangler secret put TEAM_DOMAIN
```

Secrets take effect right away, with no redeploy needed.

## 6. Route incoming mail to the Worker

1. In the Cloudflare dashboard, open your domain → **Email → Email Routing** and enable it if you haven't yet. Cloudflare adds the MX and SPF records.
2. Under **Routing rules**, edit the **Catch-all address**: set *Action* to **Send to a Worker** and *Destination* to this Worker. Enable it.
   - Alternatively, add a rule per address (`alice@example.com → Worker`).
3. Repeat for each domain in `DOMAINS`.

## 7. (Optional) Custom domain

Under *Workers & Pages → your Worker → Settings → Domains & Routes*, add a custom domain such as `mail.example.com`, and make sure Access protects it as well.

## 8. Verify

1. Open the app and sign in through Access. You should land in your inbox.
2. Send yourself an email from an outside account (e.g. Gmail). It should appear in your Inbox within seconds.
3. Reply from the app. The reply should arrive in Gmail, threaded under the original.
4. Check *Sent* in the app.

Watch live logs while testing:

```bash
bunx wrangler tail
```

## Upgrading from the upstream `agentic-inbox`

This fork removes the AI agent and MCP server. `wrangler.jsonc` contains a `v4` migration that **deletes the `EmailAgent` and `EmailMCP` Durable Object classes**, together with any agent chat history stored in them. Mailboxes, emails and attachments (`MailboxDO` + R2) are not affected.

Things to check after upgrading:

- The `send_email` and `ai` bindings are gone. Set up SMTP as described above.
- Mailboxes are now per-user. Existing mailboxes stay in R2 and become visible to whoever is their owner under the new rules. Shared mailboxes need a `MAILBOX_OWNERS` entry.
- The "create mailbox" and "delete mailbox" buttons are gone. Mailboxes are created automatically.

## Rollback

```bash
bunx wrangler deployments list
bunx wrangler rollback <deployment-id>
```

Note: a rollback can't undo the Durable Object class deletion in migration `v4`.

## What's committed vs. generated

The repository contains everything needed to build and deploy. The gitignored files are either generated or local-only:

| Ignored path | What it is | How it's recreated |
| --- | --- | --- |
| `node_modules/` | Dependencies | `bun install` (from `bun.lock`) |
| `build/` | Production bundle | `bun run build` (also run by `bun run deploy`) |
| `worker-configuration.d.ts`, `.react-router/`, `*.tsbuildinfo` | Generated types / TS cache | `bun run typecheck`. Only needed for type checking, not for building. |
| `.wrangler/` | Local dev state (local DOs, R2) and Wrangler cache | Created by `bun run dev` |
| `.dev.vars` | **Local** secrets and settings | Copy from `.dev.vars.example`. **Never used in production.** |

In production, the values from `.dev.vars` come from **Worker secrets** instead (`SMTP_USERNAME`, `SMTP_PASSWORD`, `POLICY_AUD`, `TEAM_DOMAIN`, `MAILBOX_OWNERS`). They live in your Cloudflare account, not in git, and stay in place across deploys.

## Deploying from Git (Workers Builds)

Instead of running `bun run deploy` yourself, you can let Cloudflare build on every push:

1. *Workers & Pages → your Worker → Settings → Build → Connect* your GitHub repository.
2. Set **Build command** to `bun run build` and **Deploy command** to `bunx wrangler deploy`. Cloudflare's build image detects `bun.lock` and installs with Bun.
3. Set the production branch (e.g. `master`).

Secrets set with `wrangler secret put` (or in the dashboard under *Settings → Variables and Secrets*) are kept across builds. Don't add them to the build environment.

## CI (optional)

Any CI that has Bun and Node installed can deploy:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run deploy   # needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment
```
