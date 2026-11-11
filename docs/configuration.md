# Configuration

There are two kinds of configuration:

- **Variables** (`vars` in `wrangler.jsonc`) are non-secret and committed to the repository.
- **Secrets** are set with `bunx wrangler secret put NAME` in production, or in `.dev.vars` locally. Never put secrets in `wrangler.jsonc`.

Run `bun run typecheck` after editing `wrangler.jsonc` so the generated types stay in sync.

## Variables (`wrangler.jsonc`)

| Name | Required | Example | Description |
| --- | --- | --- | --- |
| `DOMAINS` | yes | `"example.com"` or `"example.com,example.org"` | Comma-separated domains this inbox hosts. Only addresses on these domains get mailboxes. |
| `EMAIL_ADDRESSES` | no | `["alice@example.com", "bob@example.com"]` | Allowlist. If empty, **any** address on `DOMAINS` may sign in and get a mailbox. If set, only these addresses can. Listed addresses also receive mail *before* their owner first signs in. |
| `CF_ZONE_ID` | recommended | `"023e105f4ecef8ad9ca31a8372d0c353"` | Zone ID(s) of your domain(s), comma-separated. With `CF_API_TOKEN`, enables the [member directory](./members.md): forwarding rules in Email Routing decide who can open which mailbox. |
| `MAILBOX_OWNERS` | no | `{ "alice@gmail.com": ["alice@example.com"] }` | Manual override, merged with the [member directory](./members.md). Maps a Cloudflare Access identity to extra mailboxes. Use it when someone signs in with an identity that isn't their inbox address (e.g. a personal Gmail), or to give one person a shared mailbox such as `support@`. Values can be a string or an array. Set it as a **secret** by default (see below); you can also define it here as an object. See [Authentication](./authentication.md). |
| `SMTP_HOST` | yes | `"mail.smtp2go.com"` | SMTP relay hostname. |
| `SMTP_PORT` | no | `"465"` | Port. Defaults to 465 for `tls` and 587 otherwise. **Port 25 is not allowed**, because Workers block it. |
| `SMTP_SECURE` | no | `"tls"` | `tls` = implicit TLS (465), `starttls` = upgrade after connecting (587 / 2525), `none` = plaintext. Use `none` only for local testing. |

## Secrets

| Name | Required | Description |
| --- | --- | --- |
| `SMTP_USERNAME` | usually | SMTP username. |
| `SMTP_PASSWORD` | usually | SMTP password. |
| `POLICY_AUD` | production | The Cloudflare Access application's Audience (AUD) tag. |
| `TEAM_DOMAIN` | production | Your Access team URL, e.g. `https://your-team.cloudflareaccess.com` (or the full `/cdn-cgi/access/certs` URL). |
| `CF_API_TOKEN` | recommended | Read-only Cloudflare API token (*Zone → Email Routing Rules → Read*) for the [member directory](./members.md). |
| `MAILBOX_OWNERS` | no | JSON string, e.g. `{"you@gmail.com":["you@example.com"]}`. It's a secret because it contains personal addresses that shouldn't be committed. |
| `DEV_USER_EMAIL` | local only | The identity to act as in `bun run dev`. Ignored in production. |

Set production secrets:

```bash
bunx wrangler secret put SMTP_USERNAME
bunx wrangler secret put SMTP_PASSWORD
bunx wrangler secret put POLICY_AUD
bunx wrangler secret put TEAM_DOMAIN
```

If needed, set `MAILBOX_OWNERS` the same way and paste the JSON on one line when prompted:

```bash
bunx wrangler secret put MAILBOX_OWNERS
# {"you@gmail.com":["you@example.com"]}
```

Locally, put the same line in `.dev.vars`: `MAILBOX_OWNERS={"you@gmail.com":["you@example.com"]}`.

> If you'd rather keep it in `wrangler.jsonc` (e.g. it holds only company addresses for shared mailboxes), add `"MAILBOX_OWNERS": { ... }` under `vars` instead. Don't do both, because a var and a secret can't share a name.

## Example: a small team

```jsonc
"vars": {
	"DOMAINS": "acme.com",
	"EMAIL_ADDRESSES": ["alice@acme.com", "bob@acme.com", "support@acme.com"],
	"MAILBOX_OWNERS": {
		"alice@acme.com": ["support@acme.com"],
		"bob@acme.com": ["support@acme.com"]
	},
	"SMTP_HOST": "mail.smtp2go.com",
	"SMTP_PORT": "465",
	"SMTP_SECURE": "tls"
}
```

- Alice and Bob sign in through Access as `alice@acme.com` and `bob@acme.com`.
- Each of them sees their own mailbox plus the shared `support@acme.com`.
- Mail to `support@acme.com` is accepted even before anyone has signed in.
- Mail to `random@acme.com` is rejected, because that address isn't in the allowlist.

## Mailbox settings (in the app)

Each mailbox has a settings page (gear icon) where its owner sets the **Display name** used in the `From:` header of outgoing mail.

## Limits

- Sending is rate-limited per mailbox: **20 emails per hour** and **100 per day**. The limit lives in `checkSendRateLimit` in `workers/durableObject/index.ts`.
- Inbound messages larger than **25 MB** are rejected (`MAX_EMAIL_SIZE` in `workers/index.ts`).
- Your SMTP provider has its own limits too (see [SMTP sending](./smtp.md)).

## Renaming the Worker / bucket

The Worker is still named `agentic-inbox` and so is the R2 bucket. That way an existing deployment of the upstream project keeps its data. To rename them for a **fresh** deployment, change `name` and `bucket_name` / `preview_bucket_name` in `wrangler.jsonc` before the first deploy. Renaming an existing deployment creates a new, empty Worker.
