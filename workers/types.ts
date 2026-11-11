// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	// Cloudflare Access (secrets, required in production)
	POLICY_AUD: string;
	TEAM_DOMAIN: string;

	// SMTP credentials (secrets). Typed as string, but may be unset at runtime.
	SMTP_USERNAME: string;
	SMTP_PASSWORD: string;

	// Cloudflare API token (secret) with read access to Email Routing rules,
	// used to build the member directory. See docs/members.md.
	CF_API_TOKEN: string;

	// Local development only: the identity to act as, since there is no
	// Cloudflare Access in front of `bun run dev`. Set it in .dev.vars.
	DEV_USER_EMAIL: string;
}
