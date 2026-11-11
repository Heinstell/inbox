# Members: managed from Email Routing

You manage members in one place only: **Cloudflare Email Routing**. You never add people in this app or in Cloudflare Access.

A rule like

```
john@heinstell.com  →  Forward to  john@gmail.com      (rule DISABLED)
```

means:

- **John signs in** to the inbox with `john@gmail.com` (one-time PIN to his Gmail) and sees **only** `john@heinstell.com`.
- **Mail to `john@heinstell.com`** is stored in his inbox **and** a copy is forwarded to `john@gmail.com`, so his Gmail keeps working exactly as before.
- **John can send** as `john@heinstell.com` from the inbox.

## Why the rule is disabled

Email Routing runs exactly **one** rule per address, and a rule has **one** action. An *enabled* forwarding rule sends the mail straight to Gmail, so the inbox never sees it.

When you **disable** the rule, Cloudflare stops forwarding directly. The mail falls through to the **catch-all rule**, which sends it to this Worker. The Worker then:

1. reads your rules (read-only API token, cached for 60 seconds),
2. stores the message in `john@heinstell.com`'s inbox,
3. forwards a copy to every destination in John's rule (`message.forward()`; the address must be a verified destination, which it already is).

The disabled rule is your **member list**: "disabled" means "Cloudflare doesn't forward it directly; the inbox does".

If you forget to disable a rule, nothing breaks: the person still gets all mail in Gmail and can sign in, but their inbox in the app stays empty until you disable it.

---

## One-time setup

Do these once, after the first deploy ([Deployment](./deployment.md)).

### 1. Find your Zone ID

Cloudflare dashboard → **heinstell.com** → *Overview*. The **Zone ID** is in the right-hand column, under *API*. Copy it.

Put it in `wrangler.jsonc`:

```jsonc
"CF_ZONE_ID": "your-zone-id",
```

The zone ID isn't secret. For several domains, list them comma-separated (`"id1,id2"`) and add every domain to `DOMAINS`.

### 2. Create a read-only API token

1. Dashboard → top-right profile icon → **My Profile → API Tokens → Create Token → Create Custom Token**.
2. **Token name:** `inbox – read email routing`.
3. **Permissions:** `Zone` → `Email Routing Rules` → `Read`.
4. **Zone Resources:** `Include` → `Specific zone` → `heinstell.com`.
5. **Continue to summary → Create Token**, then copy the token. It's shown only once.

Save it as a secret:

```powershell
bunx wrangler secret put CF_API_TOKEN
```

The token can only *read* routing rules. The app can't change your email setup.

### 3. Point the catch-all at the Worker

Dashboard → **heinstell.com → Email → Email Routing → Routing rules → Catch-all address**:

- **Action:** *Send to a Worker*
- **Destination:** `agentic-inbox`
- **Status:** enabled

### 4. Let Cloudflare Access admit anyone with a verified email

Membership is now decided by your routing rules, so Access only needs to prove *who* someone is.

1. Zero Trust → **Access → Applications** → the inbox app → **Policies**.
2. Edit the Allow policy: **Include → Everyone**.
3. Zero Trust → **Settings → Authentication**: make sure **One-time PIN** is enabled and selected for the app.

Anyone can request a PIN, but someone without a forwarding rule only sees *"No mailbox for this account"* and no data. The Worker enforces this on every API request.

> Want a second gate? Instead of *Everyone*, include specific email domains (e.g. *Emails ending in* `@gmail.com`), or an Access list.

### 5. Deploy

```powershell
bun run deploy
```

---

## Adding a member

1. **Email Routing → Destination addresses → Add destination address:** `john@gmail.com`. John clicks the verification link Cloudflare sends him. (Skip this if he's already verified.)
2. **Email Routing → Routing rules → Create address:**
   - **Custom address:** `john`
   - **Action:** *Send to an email*
   - **Destination:** `john@gmail.com`
   - **Save.**
3. **Disable** the new rule with its toggle.
4. Tell John: *go to `https://<your inbox URL>` and sign in with john@gmail.com*.

Changes take effect within about a minute.

## Removing a member

Delete their routing rule. Within a minute they lose access to the mailbox and stop receiving forwarded copies. Their stored mail stays in the app's storage.

## Shared mailboxes

A rule can forward to several destinations (if your plan and the dashboard allow it). Everyone listed gets access and a copy. For more control, use the `MAILBOX_OWNERS` override ([Configuration](./configuration.md)), which is merged with the rules.

## What counts as a member rule

The Worker reads every rule on the zone and uses only these:

| Rule | Used? |
| --- | --- |
| Custom address on one of `DOMAINS` → *Send to an email* | ✅ Owner = each destination, copy forwarded to each |
| Same, but the destination is on your own domain (e.g. `sales@ → john@heinstell.com`) | Owner yes, but **no copy forwarded**: forwarding to your own domain would loop back to the Worker |
| Catch-all, *Send to a Worker*, *Drop* | ❌ ignored |

Enabled and disabled forwarding rules both grant sign-in access. Only disabled ones deliver mail to the inbox.

## Local development

Put the token in `.dev.vars` (`CF_API_TOKEN=…`) and set `CF_ZONE_ID` in `wrangler.jsonc`. The dev server then reads your real rules. Set `DEV_USER_EMAIL` to a Gmail that has a rule to act as that member.

Forwarding isn't really sent locally: the dev server only logs `Email handler forwarded message with rcptTo: …`.
