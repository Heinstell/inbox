# Authentication & mailbox access

The whole app sits behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/). Access handles sign-in. The Worker then works out **which mailbox(es) the signed-in person may see** and refuses everything else.

## How a request is authorized

1. Access signs the user in and adds a signed JWT to each request (`Cf-Access-Jwt-Assertion`).
2. `workers/app.ts` verifies the JWT against your team's public keys, `TEAM_DOMAIN` and `POLICY_AUD`, and reads the user's **email** claim. If Access isn't configured, the Worker refuses to serve anything (fail closed).
3. `workers/lib/auth.ts` computes the user's allowed mailboxes:
   - **their own address**, when it is on one of `DOMAINS` (and in `EMAIL_ADDRESSES`, if that allowlist is set),
   - **any mailbox whose Email Routing rule forwards to their identity**: the rule `john@example.com → john@gmail.com` lets `john@gmail.com` in. See [Members](./members.md). This is the recommended way to manage a team.
   - **any mailbox assigned to them in `MAILBOX_OWNERS`** (manual override).
4. Every `/api/v1/mailboxes/:mailboxId/...` request checks that `mailboxId` is in that list (`workers/lib/mailbox.ts`). Any other mailbox returns `404 Not found`, which also hides whether that mailbox exists.
5. A mailbox is created automatically the first time its owner opens the app.

So `alice@example.com` signs in and lands straight in the `alice@example.com` inbox. She can't open `bob@example.com`, even by typing its URL or calling the API.

## Choosing an identity provider

Your choice matters, because the **email claim must be something the Worker can map to a mailbox**.

### Option A: an identity provider that knows your domain addresses (recommended)

Use Google Workspace, Microsoft Entra ID, Okta or any SAML/OIDC provider where users already have `@yourdomain` accounts. Their Access identity *is* their inbox address and needs no extra configuration.

### Option B: personal identities, mapped with `MAILBOX_OWNERS`

If your domain has no identity provider, users can sign in with an identity they already control: a personal Gmail through the Google login, GitHub, or a one-time PIN sent to a personal address. Map each identity to the mailbox with the `MAILBOX_OWNERS` secret:

```bash
bunx wrangler secret put MAILBOX_OWNERS
# {"alice.personal@gmail.com":["alice@example.com"],"bob@outlook.com":["bob@example.com"]}
```

See the [walkthrough below](#walkthrough-sign-in-with-a-personal-gmail).

### ⚠️ Avoid: one-time PIN to the domain address itself

Access's **One-time PIN** sends a login code *by email*. If the code goes to `alice@example.com`, it lands in the inbox Alice is trying to sign in to, so she can never read it. Only use one-time PIN with personal addresses mapped through `MAILBOX_OWNERS` (Option B).

## Setting up Access

The quickest route is **one-click Access for Workers**:

1. Deploy the Worker once (see [Deployment](./deployment.md)).
2. In the Cloudflare dashboard, go to *Workers & Pages → your Worker → Settings → Domains & Routes*. Next to your `workers.dev` route or custom domain, enable **Cloudflare Access**.
3. A dialog shows the **`POLICY_AUD`** (audience tag) and **`TEAM_DOMAIN`** values. Save them as secrets:

   ```bash
   bunx wrangler secret put POLICY_AUD
   bunx wrangler secret put TEAM_DOMAIN
   ```

4. In *Zero Trust → Access → Applications*, open the application that was created and edit its **policy**. One-click Access starts with a permissive default, so restrict it to the people who should have inboxes. For example:
   - *Include → Emails ending in* `@example.com` (Option A), or
   - *Include → Emails* listing each allowed identity (Option B).
5. Add your login method: Cloudflare One (`one.dash.cloudflare.com`) → **Integrations → Identity providers → Add an identity provider** (older dashboards: *Settings → Authentication → Login methods*). For Gmail sign-in, use **One-time PIN**.
6. In the application's **Authentication** tab: turn **off** *Accept all available identity providers*, select only your provider (e.g. **One-time PIN**; remove "Cloudflare", which only admits dashboard users), and turn **on** *Apply instant authentication*.

When the one-click dialog asks who may access the app, choose **email domain** with the domain people **sign in with** (e.g. `gmail.com`), not *Cloudflare account*. The policy action must be **Allow**; *Bypass* lets people through without signing in, and the app then rejects them with *Missing required CF Access JWT*.

The Access policy decides **who may reach the app at all**. The Worker decides **which mailbox each of them sees**. Keep both tight.

### Signing out

The **Sign out** button (header, and the home screen) goes to `/cdn-cgi/access/logout`, which ends the Access session.

## Walkthrough: sign in with a personal Gmail (manual mapping)

> For a team, prefer [Members](./members.md): the same result, driven by your Email Routing rules with no per-person config. This section is the manual alternative.

Scenario: you own `you@example.com` and already forward it to `you@gmail.com` with an Email Routing rule. You want to sign in to the inbox *as your Gmail* and see `you@example.com`.

1. **Map the identity to the mailbox:**

   ```bash
   bunx wrangler secret put MAILBOX_OWNERS
   # {"you@gmail.com":["you@example.com"]}
   ```

2. **Restrict the Access policy to that identity.** In *Zero Trust → Access → Applications → your app → Policies*, edit the Allow policy: *Include → Emails →* `you@gmail.com`. Remove any broader rule such as "Everyone".

3. **Choose a login method** in *Zero Trust → Settings → Authentication* and enable it on the application:
   - **One-time PIN**: the code goes to `you@gmail.com`, which you can read independently of this app. No setup needed.
   - **Google**: "Sign in with Google" with your Gmail account. This needs a Google OAuth client ([guide](https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/google/)).

4. **Route `you@example.com` to the Worker.** ⚠️ An Email Routing rule has exactly **one** action. While a rule says `you@example.com → forward to you@gmail.com`, that mail goes to Gmail only and **never reaches this inbox**. The catch-all only applies to addresses with no specific rule. In *Email → Email Routing → Routing rules*, either:
   - change that rule's action to **Send to a Worker** (this Worker), or
   - delete the rule, so the catch-all (→ Worker) handles it.

   After this, mail for `you@example.com` lands in the inbox app and is no longer copied to Gmail.

5. Open the app. Access asks for your Gmail and you land in `you@example.com`.

For local development, the equivalent `.dev.vars` is:

```ini
DEV_USER_EMAIL=you@gmail.com
MAILBOX_OWNERS={"you@gmail.com":["you@example.com"]}
```

## Shared mailboxes

To give several people a shared mailbox such as `support@example.com`, list it under each person in `MAILBOX_OWNERS`. Add it to `EMAIL_ADDRESSES` too, if you use that allowlist:

```json
{"alice@example.com":["support@example.com"],"bob@example.com":["support@example.com"]}
```

Anyone with more than one mailbox gets a mailbox picker on the home screen, plus a *Mailboxes* link in the sidebar.

## Which incoming mail is accepted

For each incoming message, Email Routing gives the Worker the actual (envelope) recipient. The Worker:

- **rejects** it if the address isn't on `DOMAINS` (or isn't in `EMAIL_ADDRESSES`, when that is set),
- **stores** it if the mailbox already exists (its owner has signed in at least once),
- **creates the mailbox and stores it** if the address is listed in `EMAIL_ADDRESSES` or `MAILBOX_OWNERS`, or has a forwarding rule in Email Routing,
- **forwards a copy** to the destinations in the address's Email Routing rule, if any ([Members](./members.md)),
- otherwise **rejects** it with "Unknown recipient", and the sender gets a bounce.

To make sure nobody misses mail before their first sign-in, list everyone in `EMAIL_ADDRESSES`.

## Local development

`bun run dev` has no Access in front of it. The Worker acts as `DEV_USER_EMAIL` from `.dev.vars` instead. If that isn't set, the app shows "You're not signed in".
