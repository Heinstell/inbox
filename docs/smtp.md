# SMTP sending

Outgoing mail is delivered by your own SMTP relay instead of Cloudflare Email Service. The Worker opens a TCP connection with the [Workers TCP sockets API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), authenticates, and hands the message over (`workers/lib/smtp.ts`). The MIME message is built in `workers/lib/mime.ts`.

What the client supports:

- Implicit TLS (`SMTP_SECURE=tls`) and STARTTLS (`SMTP_SECURE=starttls`)
- `AUTH PLAIN` and `AUTH LOGIN`
- HTML with an auto-generated plain-text alternative, UTF-8 subjects and names, attachments and inline images
- Proper `Message-ID`, `In-Reply-To` and `References` headers, so replies thread correctly in the recipient's client
- Bcc recipients go into the SMTP envelope only, never into the headers

Sending is **synchronous**. If the relay rejects the message, the user sees the error and the message is *not* saved to Sent.

## SMTP2GO

1. **Create an account** at [smtp2go.com](https://www.smtp2go.com).
2. **Verify your sender domain**: *Sending → Verified Senders → Add sender domain*, then enter your domain (e.g. `example.com`). SMTP2GO shows a few **CNAME** records (DKIM, return-path, tracking). Add them in the Cloudflare dashboard under *DNS → Records*, with **Proxy status: DNS only** (grey cloud). Wait until SMTP2GO shows the domain as verified.
3. **Create an SMTP user**: *Sending → SMTP Users → Add SMTP User*. Note the username and password.
4. **Configure the Worker.** In `wrangler.jsonc`:

   ```jsonc
   "SMTP_HOST": "mail.smtp2go.com",
   "SMTP_PORT": "465",
   "SMTP_SECURE": "tls"
   ```

   Then set the credentials as secrets:

   ```bash
   bunx wrangler secret put SMTP_USERNAME
   bunx wrangler secret put SMTP_PASSWORD
   ```

   SMTP2GO also accepts STARTTLS on `2525`, `587` or `8025` (`SMTP_SECURE=starttls`) and implicit TLS on `465`, `8465` or `443`.

### SPF / DKIM / DMARC with Email Routing

Email Routing manages your domain's **MX** records and adds an SPF record (`v=spf1 include:_spf.mx.cloudflare.net ~all`). SMTP2GO's verified-sender CNAMEs handle DKIM and a custom return-path, which is what makes SPF and DKIM *align* for DMARC. You normally **don't** need to change your root SPF record. If you do add SMTP2GO to it, edit the existing record. Never create a second `v=spf1` TXT record, because two SPF records make SPF fail.

A minimal DMARC record to start with:

```
_dmarc.example.com  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
```

## Other providers

Any authenticated SMTP relay works. Some common settings:

| Provider | `SMTP_HOST` | `SMTP_PORT` / `SMTP_SECURE` | Username |
| --- | --- | --- | --- |
| SMTP2GO | `mail.smtp2go.com` | `465` / `tls` | SMTP user |
| Mailgun | `smtp.mailgun.org` (EU: `smtp.eu.mailgun.org`) | `465` / `tls` | SMTP credential login |
| Postmark | `smtp.postmarkapp.com` | `587` / `starttls` | Server API token (as both username and password) |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `465` / `tls` | SES SMTP credentials |
| Brevo | `smtp-relay.brevo.com` | `587` / `starttls` | SMTP login |
| Resend | `smtp.resend.com` | `465` / `tls` | `resend` / API key |

Check your provider's docs for the current values, and verify your sending domain with them.

## Restrictions

- **Port 25 is blocked** for outbound connections from Workers. Use 465, 587 or 2525.
- The Worker only sends **from the mailbox's own address**. A user can't spoof another address.
- Per-mailbox limits are 20 messages per hour and 100 per day (see [Configuration](./configuration.md#limits)). Your provider's plan limits apply on top of that.
- Each send must finish within 30 seconds.

## Testing without sending real mail

Point the dev server at a local SMTP catcher such as [Mailpit](https://mailpit.axllent.org/):

```bash
# start Mailpit (SMTP on 1025, web UI on 8025)
mailpit
```

```ini
# .dev.vars
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURE=none
```

The unit tests in `tests/smtp.test.ts` (`bun run test`) run the SMTP client against a fake in-process server.
