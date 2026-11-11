# Troubleshooting

Start with live logs: `bunx wrangler tail`.

## Sign-in / access

| Symptom | Cause & fix |
| --- | --- |
| `Cloudflare Access must be configured in production` | `POLICY_AUD` or `TEAM_DOMAIN` secret is missing. Enable Access on the Worker and set both secrets ([Authentication](./authentication.md#setting-up-access)). |
| `Invalid or expired Access token` | `POLICY_AUD` / `TEAM_DOMAIN` don't match the Access application. Turn Access off and on again for the Worker to see the current values in the dialog, and reset the secrets. See the [Access reset docs](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/). |
| `Missing required CF Access JWT` | The request didn't go through Access, e.g. a route or custom domain that Access doesn't cover. Protect every hostname that serves the Worker. |
| `Access token has no user email` | You're using a service token. The inbox needs a real user login. |
| "No mailbox for this account" | No Email Routing rule forwards to the address you signed in with, and it has no `MAILBOX_OWNERS` entry. Check that the rule's destination is exactly that address, and wait a minute (cache). Make sure `CF_ZONE_ID` and `CF_API_TOKEN` are set. |
| API error `Could not load Email Routing rules: … Authentication error` (logs) / 500 on every page | `CF_API_TOKEN` is wrong or lacks *Zone → Email Routing Rules → Read* on that zone, or `CF_ZONE_ID` is wrong. |
| Can't sign in with one-time PIN | The PIN is going to the inbox you're trying to open. Use an identity provider, or map a personal address through `MAILBOX_OWNERS` ([details](./authentication.md#-avoid-one-time-pin-to-the-domain-address-itself)). |
| Local: "You're not signed in" | Set `DEV_USER_EMAIL` in `.dev.vars` and restart `bun run dev`. |

## Sending

| Error shown when sending | Cause & fix |
| --- | --- |
| `SMTP is not configured: set SMTP_HOST` | Set `SMTP_HOST` in `wrangler.jsonc` (or `.dev.vars`). |
| `Cloudflare Workers cannot connect to port 25` | Use 465 (`tls`), or 587 / 2525 (`starttls`). |
| `Could not talk to host:port: …` | Wrong host/port, or the wrong `SMTP_SECURE` for that port (e.g. `tls` on 587). Use `tls` on 465 and `starttls` on 587 / 2525. |
| `SMTP server does not support STARTTLS` | That port expects implicit TLS. Switch to `SMTP_SECURE=tls` and port 465. |
| `SMTP AUTH failed: 535 …` | Wrong `SMTP_USERNAME` / `SMTP_PASSWORD`. Re-set the secrets. |
| `SMTP MAIL FROM… failed: 5xx` | Your provider hasn't verified the sending domain/address. Finish sender verification ([SMTP sending](./smtp.md)). |
| `SMTP RCPT TO… failed: 550` | The recipient was refused (invalid address, or the provider blocked it). |
| `SMTP timed out after 30000ms` | The relay is unreachable or very slow. Check the provider's status page. |
| `Rate limit exceeded` | 20/hour or 100/day per mailbox. Wait, or raise the limit in `checkSendRateLimit`. |
| Mail is sent but lands in spam | Make sure DKIM (the provider's CNAMEs) is verified, keep exactly **one** SPF record, and add DMARC. |

## Receiving

| Symptom | Cause & fix |
| --- | --- |
| Senders get "Unknown recipient" bounces | The address has no mailbox yet. Its owner can sign in once, or you can add the address to `EMAIL_ADDRESSES` / `MAILBOX_OWNERS` so it's created automatically. |
| Mail goes to Gmail but not the inbox | The person's forwarding rule is still **enabled**. Disable it so mail falls through to the catch-all → Worker ([why](./members.md#why-the-rule-is-disabled)). |
| Mail reaches the inbox but no Gmail copy | The destination isn't a **verified** destination address, or it's on your own domain (no copies to your own domains, to avoid loops). Look for `Forwarding … failed` in `wrangler tail`. |
| Nothing arrives, no logs | Email Routing isn't sending to the Worker. Check that the catch-all (or per-address) rule's action is *Send to a Worker* and that it's enabled. |
| Some messages are rejected | Messages over 25 MB are refused. |

## Development

| Symptom | Cause & fix |
| --- | --- |
| `Wrangler does not support the Bun runtime` | Don't run Wrangler with `bun --bun`. Use `bunx wrangler …` or the provided scripts. Node must be installed. |
| `bun run dev` fails with `ConnectionRefused … __vite_plugin_cloudflare_get_export_types__` | The dev server was started on the Bun runtime (`bun --bun`). Miniflare needs Node. Use `bun run dev` as defined in `package.json`. |
| Type errors about `Env` after editing `wrangler.jsonc` | Run `bun run typecheck`, which regenerates `worker-configuration.d.ts`. |
