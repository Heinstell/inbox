# Setup

## Prerequisites

| Requirement | Why |
| --- | --- |
| A Cloudflare account with your domain on it (DNS managed by Cloudflare) | Email Routing, Workers, R2, Access |
| [Bun](https://bun.sh) ≥ 1.2 | Package manager, script runner and test runner |
| [Node.js](https://nodejs.org) ≥ 20 installed on the machine | **Wrangler and Miniflare (the local Workers runtime) do not run on the Bun runtime.** Bun launches them, but they execute on Node behind the scenes. You never call `node` or `npm` yourself. |
| An SMTP relay account, e.g. [SMTP2GO](https://www.smtp2go.com) | Sending email. See [SMTP sending](./smtp.md). |

Install Bun:

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Install dependencies

```bash
bun install
```

This uses `bun.lock`. Don't use `npm install`: the repository has no `package-lock.json`.

## Log in to Cloudflare

```bash
bunx wrangler login
```

## Configure for local development

1. Edit `wrangler.jsonc` and set `DOMAINS` to your domain (e.g. `"example.com"`). See [Configuration](./configuration.md).
2. Create your local secrets file:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. In `.dev.vars`, set:
   - `DEV_USER_EMAIL`: the address you want to act as locally, e.g. `you@example.com`. Local development has no Cloudflare Access, so this stands in for the signed-in user. It must be on one of your `DOMAINS`.
   - `SMTP_*`: your SMTP relay credentials. You can also use a local catcher such as [Mailpit](https://mailpit.axllent.org/) with `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025` and `SMTP_SECURE=none` so you don't send real mail while developing.

## Run locally

```bash
bun run dev
```

The app opens at the printed URL (usually `http://localhost:5173`). Your mailbox is created automatically the first time you open it.

Local Durable Object and R2 data are kept under `.wrangler/state`. Delete that folder to start from scratch.

### Simulating incoming mail locally

The local runtime exposes an email endpoint. The message needs a `Message-ID` header:

```bash
printf 'From: Bob <bob@other.com>\r\nTo: you@example.com\r\nSubject: Hello\r\nMessage-ID: <test1@other.com>\r\n\r\nHi there\r\n' > test.eml
curl -X POST "http://localhost:5173/cdn-cgi/handler/email?from=bob@other.com&to=you@example.com" --data-binary @test.eml
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Local dev server with hot reload |
| `bun run build` | Production build into `build/` |
| `bun run typecheck` | Generate Worker types, then run TypeScript |
| `bun run test` | Unit tests (SMTP client, MIME builder, authorization) |
| `bun run deploy` | Build and deploy to Cloudflare |
| `bun run preview` | Build, then serve the production build locally |

Next: [Deployment](./deployment.md).
