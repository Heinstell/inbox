# Step by step: from zero to a working inbox

This is the complete setup in the order that works, including the errors you'll hit if a step is skipped and how to fix each one.

Throughout this guide:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `yourdomain.com` | Your domain (on Cloudflare) | `acme.com` |
| `you@yourdomain.com` | Your mailbox in the inbox | `john@acme.com` |
| `you@gmail.com` | The personal address you sign in with and receive copies at | `john@gmail.com` |
| `<worker-url>` | Your Worker's URL | `agentic-inbox.<subdomain>.workers.dev` |

How it fits together:

- **Email Routing** receives mail for `yourdomain.com` and hands it to the Worker.
- The **Worker** stores the mail in the inbox and forwards a copy to the member's Gmail.
- Outgoing mail goes through **SMTP2GO**.
- **Cloudflare Access** signs people in with a one-time PIN sent to their Gmail.
- **Membership** comes from your Email Routing rules. You never configure members in the app.

---

## Part 1: Prerequisites

1. A Cloudflare account with `yourdomain.com` added, and its DNS managed by Cloudflare.
2. [Bun](https://bun.sh) installed:
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```
3. [Node.js](https://nodejs.org) 20+ installed. You never run it directly, but Wrangler and the local dev server need it.
4. An [SMTP2GO](https://www.smtp2go.com) account.

Install the project's dependencies:

```powershell
bun install
```

---

## Part 2: SMTP2GO (sending)

1. **Verify your domain:** SMTP2GO → *Sending → Verified Senders → Add sender domain* → `yourdomain.com`.
2. SMTP2GO shows several **CNAME** records. Add each one in Cloudflare → `yourdomain.com` → **DNS → Records**, with **Proxy status: DNS only** (grey cloud).
3. Wait until SMTP2GO shows the domain as **verified**.
4. **Create SMTP credentials:** SMTP2GO → *Sending → SMTP Users → Add SMTP User*. Note the **username** and **password**.

Don't create a second SPF (`v=spf1`) record. Email Routing already has one, and SMTP2GO's CNAMEs take care of DKIM.

---

## Part 3: Configure the project

Edit `wrangler.jsonc`:

```jsonc
"vars": {
	"DOMAINS": "yourdomain.com",
	"EMAIL_ADDRESSES": [],
	"CF_ZONE_ID": "<your zone id>",      // see below
	"SMTP_HOST": "mail.smtp2go.com",
	"SMTP_PORT": "465",
	"SMTP_SECURE": "tls"
}
```

**Zone ID:** Cloudflare dashboard → `yourdomain.com` → **Overview** → right-hand column → *API* → **Zone ID**. It's not a secret, so it's fine in the repo.

---

## Part 4: Log in with Wrangler and pick the right account

```powershell
bunx wrangler login      # opens the browser
bunx wrangler whoami     # shows your user and every account it can reach
```

The Worker **must** be deployed to the **same account that owns `yourdomain.com`**, because Email Routing, Access and the Worker have to live together. To find that account's ID, open `yourdomain.com` in the dashboard: the URL is `dash.cloudflare.com/<account id>/yourdomain.com`.

If `whoami` lists more than one account, pin the right one in `wrangler.jsonc`:

```jsonc
"account_id": "<account id that owns yourdomain.com>",
```

> **Error: `Not logged in. Your auth token has expired`.** Run `bunx wrangler login` again.

---

## Part 5: Create the R2 bucket

The R2 bucket stores mailbox settings and attachments.

```powershell
bunx wrangler r2 bucket create agentic-inbox
```

> **Error on deploy: `R2 bucket 'agentic-inbox' not found [code: 10085]`.** You skipped this step, or created the bucket in a different account. Run the command above.
>
> **Error: `Please enable R2 through the Cloudflare Dashboard`.** Dashboard → **R2 Object Storage** → enable it (it asks for a payment method; this app's usage stays within the free tier), then run the command again.

---

## Part 6: Create a read-only API token

The Worker reads your Email Routing rules to know who the members are.

1. Dashboard → profile icon (top right) → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. **Name:** `inbox – read email routing`.
3. **Permissions:** `Zone` → `Email Routing Rules` → `Read`.
4. **Zone Resources:** `Include` → `Specific zone` → `yourdomain.com`.
5. **Continue to summary → Create Token**, then copy the token. It's shown only once.

---

## Part 7: Set the secrets

Run each command and paste the value when prompted:

```powershell
bunx wrangler secret put SMTP_USERNAME     # SMTP2GO SMTP user
bunx wrangler secret put SMTP_PASSWORD     # SMTP2GO SMTP password
bunx wrangler secret put CF_API_TOKEN      # token from Part 6
```

If the Worker doesn't exist yet, Wrangler offers to create it. Answer **yes**.

`POLICY_AUD` and `TEAM_DOMAIN` come later (Part 10), because they only exist once Access is enabled.

---

## Part 8: Deploy

```powershell
bun run deploy
```

The deploy is successful when it lists the bindings and ends with your Worker URL. Some messages during the build are harmless:

- `X [ERROR] The build was canceled`: a pre-scan step. The build still finishes (`✓ built in …`).
- `Error when using sourcemap for reporting an error`: warnings about third-party libraries.
- `Using secrets defined in .dev.vars`: local-only. `.dev.vars` is **not** uploaded to Cloudflare.

Opening the Worker URL right now shows **`Cloudflare Access must be configured in production`**. That's expected; the app refuses to run unprotected.

---

## Part 9: Enable Cloudflare Access

1. Dashboard → **Workers & Pages → agentic-inbox → Settings → Domains & Routes**.
2. On the **workers.dev** row, choose **Enable Cloudflare Access**.
3. First time only: pick a **team name** (e.g. `acme`) and the **Free** plan.
4. When asked who may access the app, choose **email domain** and enter **`gmail.com`**, the domain your members sign in with.
   - Don't choose **Cloudflare account**: that only admits people who are members of your Cloudflare dashboard.
   - Don't enter `yourdomain.com`: members sign in with Gmail, not their work address.
5. The dialog shows **`POLICY_AUD`** (the audience tag) and **`TEAM_DOMAIN`** (`https://<team>.cloudflareaccess.com`). Keep them for the next part.

Allowing all of `gmail.com` is safe. Access only proves *who* someone is; the Worker decides what they see. A Gmail user without a routing rule gets *"No mailbox for this account"* and no data.

---

## Part 10: Set the Access secrets

```powershell
bunx wrangler secret put POLICY_AUD     # the audience tag
bunx wrangler secret put TEAM_DOMAIN    # https://<team>.cloudflareaccess.com
```

These take effect immediately, with no redeploy. Check that all five secrets exist:

```powershell
bunx wrangler secret list
# CF_API_TOKEN, POLICY_AUD, SMTP_PASSWORD, SMTP_USERNAME, TEAM_DOMAIN
```

Where to find the values later:

- **AUD tag:** Cloudflare One (`one.dash.cloudflare.com`) → **Access → Applications** → your app → *Overview / Basic information* → **Application Audience (AUD) Tag**.
- **Team domain:** Cloudflare One → **Settings** → *Team name and domain*.

> **Error: `Cloudflare Access must be configured in production. Set POLICY_AUD and TEAM_DOMAIN.`** One or both secrets are missing. Run `bunx wrangler secret list` and set whichever is absent.
>
> **Error: `Invalid or expired Access token`.** A value is wrong: the AUD tag from a different application, or `TEAM_DOMAIN` without `https://`. Set it again.

---

## Part 11: Check the Access policy

Cloudflare One → **Access → Applications** → your `agentic-inbox` app → **Policies**:

| Setting | Value |
| --- | --- |
| **Action** | **Allow** (never *Bypass*, which lets people through without signing in, so the app rejects them) |
| **Include** | *Emails ending in* `@gmail.com`, or **Everyone** |

To admit members who use other providers, add more includes (*Emails ending in* `@outlook.com`, …; matching any one is enough), or use **Everyone**.

Also check the application's **hostname** (*Overview / Destinations*): it must be exactly the URL you open (`<worker-url>`), with no path.

> **Error: `Missing required CF Access JWT`.** The request reached the Worker without passing through Access. Either the action is *Bypass*, or the URL you opened (e.g. a preview URL or a custom domain) isn't one of the application's hostnames. Fix the action, or add the hostname to the application.

---

## Part 12: Add One-time PIN as the login method

By default the app may show **"Sign in with Cloudflare"**, which only works for Cloudflare dashboard users. Your members need **One-time PIN**, a code emailed to their Gmail.

**12a. Add the identity provider.**

1. Cloudflare One (`one.dash.cloudflare.com`) → **Integrations → Identity providers**.
   (Older dashboards: *Settings → Authentication → Login methods*. You can also search the dashboard for "identity providers".)
2. **Add an identity provider** → **One-time PIN** → **Save**. No configuration is needed.

**12b. Use it in the application.** Cloudflare One → **Access → Applications** → your app → **Authentication** tab → *Identity*:

| Setting | Value |
| --- | --- |
| Accept all available identity providers | **Off** |
| Select available identity providers | **One-time PIN** only (remove "Cloudflare") |
| Apply instant authentication | **On** (skips the "choose a login method" screen) |
| Authenticate with Cloudflare One Client | **Off** |

**Save**.

Optional: set the application's **Session Duration** to something like 1 week, so members don't need a new PIN every day.

---

## Part 13: Email Routing (catch-all + disabled forwarding rules)

This part decides whether mail reaches the inbox. **If you skip 13b or 13c, mail keeps going straight to Gmail and never appears in the inbox.**

Dashboard → `yourdomain.com` → **Email → Email Routing**. Enable Email Routing if you haven't; Cloudflare adds the MX and SPF records for you.

### How mail flows

```
Mail to you@yourdomain.com
        │
        ▼
Does an ENABLED rule match the address?
        │
   yes  │  no
   ┌────┴────────────────────────┐
   ▼                             ▼
Forward straight to Gmail     Catch-all → Worker (agentic-inbox)
(inbox never sees it ✗)           ├─ stores it in the inbox      ✓
                                  └─ forwards a copy to Gmail    ✓
```

Cloudflare runs **only one** rule per address. An enabled forwarding rule wins over the catch-all, so the Worker never gets the mail. A **disabled** rule is skipped for delivery, so the catch-all catches the mail. The Worker still **reads** the disabled rule to learn who owns the mailbox and where to forward the copy.

### 13a. Verify the personal address as a destination

1. **Email Routing → Destination addresses → Add destination address**.
2. Enter `you@gmail.com` and **Save**.
3. Open the verification email Cloudflare sends to that Gmail and click the link.
4. The address shows **Verified**.

Skip this if the address is already verified. The Worker can only forward copies to **verified** destinations.

### 13b. Point the catch-all at the Worker

1. **Email Routing → Routing rules**.
2. Scroll to **Catch-all address** and click **Edit**.
3. Set:
   - **Action:** *Send to a Worker*
   - **Destination:** `agentic-inbox`
4. **Save**.
5. Turn the catch-all's **Status toggle on** (enabled).

Do this **before** 13c. Otherwise there's a gap during which mail for a disabled address has nowhere to go.

`agentic-inbox` only appears in the destination list after your first successful deploy (Part 8).

### 13c. Create each member's forwarding rule, then DISABLE it

For yourself and every member:

1. **Email Routing → Routing rules → Create address**.
2. Fill in:
   - **Custom address:** `you` (this makes `you@yourdomain.com`)
   - **Action:** *Send to an email*
   - **Destination:** `you@gmail.com`
3. **Save**.
4. In the rules list, find the new rule and switch its **Status toggle off** (disabled).

If you already had forwarding rules before this inbox existed, keep them all and just switch each toggle **off**. Don't delete them: the disabled rule is the member list.

When done, the Routing rules page should look like this:

| Address | Action | Destination | Status |
| --- | --- | --- | --- |
| `you@yourdomain.com` | Send to an email | `you@gmail.com` | **Disabled** |
| `john@yourdomain.com` | Send to an email | `john@gmail.com` | **Disabled** |
| Catch-all | Send to a Worker | `agentic-inbox` | **Enabled** |

### 13d. Verify it works

1. Wait about a minute, because the Worker caches the rules for 60 seconds.
2. From another account, send a **new** email to `you@yourdomain.com`. Mail sent before the change isn't re-delivered.
3. **Email Routing → Overview / Activity log**: the latest message should show it was **delivered to the Worker**.
   - If it says **Forwarded** to your Gmail, the rule is still enabled. Go back to 13c, step 4.
   - If it says **Dropped / Rejected**, check the catch-all (13b) and see the log step below.
4. The email should now be in the **inbox** *and* in **Gmail**. The Gmail copy is forwarded by the Worker.

To see what the Worker does, run this and then send another test:

```powershell
bunx wrangler tail --format pretty
```

| Log line | Meaning / fix |
| --- | --- |
| *(no email event at all)* | Mail isn't reaching the Worker: the rule is still enabled, or the catch-all isn't *Send to a Worker* + enabled |
| `Rejecting email for … mailbox does not exist yet` | The Worker didn't find a forwarding rule for that address. Check the rule exists and that `CF_API_TOKEN` / `CF_ZONE_ID` are set |
| `Could not load Email Routing rules: …` | Bad API token or zone ID (Parts 3, 6, 7) |
| `Forwarding … failed` | Stored fine, but the Gmail copy failed: the destination isn't verified (13a) |

## Part 14: Test end to end

1. **Sign in.** Open `https://<worker-url>` in a **private window**.
   - The Access page asks for an email → `you@gmail.com`.
   - The 6-digit code arrives in Gmail from `noreply@notify.cloudflare.com`. Check spam if it doesn't show up.
   - You land in **`you@yourdomain.com`**.
2. **Receive.** From another account, email `you@yourdomain.com`. It should appear in the inbox within seconds, **and** in your Gmail.
3. **Send.** Compose a message to an outside address and send it. It should arrive, and appear in *Sent*.
4. **Reply.** Reply to the test email. The reply should land in the same conversation on the other side.
5. **Sign out.** Use the icon at the top right. It returns you to the Access login.

Watch live logs while testing:

```powershell
bunx wrangler tail
```

---

## Daily operations

### Add a member

1. **Destination addresses →** add `john@gmail.com` (John clicks the verification link).
2. **Routing rules → Create address:** `john` → *Send to an email* → `john@gmail.com`.
3. **Disable** the rule (Status toggle off). This is what makes his mail go to the inbox; see [Part 13](#part-13-email-routing-catch-all--disabled-forwarding-rules).
4. If you restrict sign-in to specific emails (Part 11), add `john@gmail.com` to the Access policy's **Include → Emails** too.
5. Send John the URL. He signs in with `john@gmail.com`.

It works within about a minute. You don't need to change anything in the app, Wrangler, or Access.

### Remove a member

Delete their routing rule. Within about a minute they lose access and stop receiving copies.

### Redeploy after code changes

```powershell
bun run deploy
```

Secrets, the R2 data and Access settings stay as they are.

---

## Local development (optional)

1. Create `.dev.vars` in the project root. It's gitignored, never commit it.
   ```ini
   DEV_USER_EMAIL=you@gmail.com
   CF_API_TOKEN=<token from Part 6>
   SMTP_HOST=mail.smtp2go.com
   SMTP_PORT=465
   SMTP_SECURE=tls
   SMTP_USERNAME=<smtp2go user>
   SMTP_PASSWORD=<smtp2go password>
   ```
   There's no Access locally, so `DEV_USER_EMAIL` stands in for the signed-in user.
2. Run:
   ```powershell
   bun run dev     # http://localhost:5173
   ```
3. To simulate incoming mail, create `test.eml`:
   ```
   From: Someone <someone@other.com>
   To: you@yourdomain.com
   Subject: Local test
   Message-ID: <test1@other.com>

   Hello!
   ```
   Then post it to the dev server:
   ```powershell
   curl.exe -X POST "http://localhost:5173/cdn-cgi/handler/email?from=someone@other.com&to=you@yourdomain.com" --data-binary "@test.eml"
   ```
   Change the `Message-ID` for each new test.

Local problems we ran into:

> **Browser error `useState … @cloudflare_kumo.js` ("Application Error").** Stale Vite cache. Stop the dev server, run `Remove-Item -Recurse -Force node_modules\.vite`, start it again, and hard-refresh (Ctrl+Shift+R).
>
> **"No mailbox for this account" locally.** `DEV_USER_EMAIL` must be an address that a routing rule forwards to (or that's mapped in `MAILBOX_OWNERS`). Restart `bun run dev` after editing `.dev.vars`.
>
> **Reset local data.** Stop the dev server, then run `Remove-Item -Recurse -Force .wrangler\state`.

---

## Error reference

| Error | Part | Fix |
| --- | --- | --- |
| `R2 bucket 'agentic-inbox' not found` | 5 | `bunx wrangler r2 bucket create agentic-inbox` in the right account |
| `Not logged in … token has expired` | 4 | `bunx wrangler login` |
| `Cloudflare Access must be configured in production` | 10 | Set `POLICY_AUD` and `TEAM_DOMAIN` |
| `Missing required CF Access JWT` | 11 | Policy action **Allow** (not Bypass); the URL must match the app's hostname |
| `Invalid or expired Access token` | 10 | Re-set `POLICY_AUD` / `TEAM_DOMAIN` from the correct application |
| Login page says "Sign in with Cloudflare" | 12 | Add One-time PIN and select only it in the app |
| Gmail login refused by Access | 9 / 11 | Policy include must admit `@gmail.com` (or Everyone), not `@yourdomain.com` |
| "No mailbox for this account" | 6, 13 | Rule must forward to exactly the address you signed in with; `CF_API_TOKEN` and `CF_ZONE_ID` set; wait a minute |
| Mail arrives in Gmail but not the inbox | 13b, 13c | Catch-all → *Send to a Worker* (enabled); member's forwarding rule **disabled**; send a **new** email |
| Mail in the inbox but no Gmail copy | 13a | The destination must be a **verified** destination address |
| Sending fails with `SMTP AUTH failed: 535` | 2, 7 | Wrong `SMTP_USERNAME` / `SMTP_PASSWORD` |
| Sending fails with `MAIL FROM … 5xx` | 2 | Finish verifying the domain in SMTP2GO |

More details are in [`docs/`](./docs/README.md), especially [Members](./docs/members.md) and [Troubleshooting](./docs/troubleshooting.md).
