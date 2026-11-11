// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Hono } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { createRequestHandler } from "react-router";
import { app as apiApp, receiveEmail } from "./index";
import type { AppVariables } from "./lib/mailbox";
import type { Env } from "./types";

export { MailboxDO } from "./durableObject";

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			env: Env;
			ctx: ExecutionContext;
		};
		/** Signed-in Access identity (or DEV_USER_EMAIL locally), if any. */
		userEmail?: string;
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

function getAccessUrls(teamDomain: string) {
	const certsPath = "/cdn-cgi/access/certs";
	const teamUrl = new URL(teamDomain);
	const issuer = teamUrl.origin;
	const certsUrl = teamUrl.pathname.endsWith(certsPath)
		? teamUrl
		: new URL(certsPath, issuer);

	return { issuer, certsUrl };
}

// Cache the JWKS fetcher per isolate so keys aren't re-downloaded per request.
let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;
function getJwks(certsUrl: URL) {
	if (!jwks || jwks.url !== certsUrl.href) {
		jwks = { url: certsUrl.href, set: createRemoteJWKSet(certsUrl) };
	}
	return jwks.set;
}

// Main app that wraps the API and adds React Router fallback
const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Cloudflare Access authentication. Validates the Access JWT and records the
// signed-in user's email, which the API uses to decide which mailbox they see.
app.use("*", async (c, next) => {
	if (import.meta.env.DEV) {
		// No Access in local development: act as DEV_USER_EMAIL from .dev.vars.
		const devUser = c.env.DEV_USER_EMAIL?.trim().toLowerCase();
		if (devUser) c.set("userEmail", devUser);
		return next();
	}

	const { POLICY_AUD, TEAM_DOMAIN } = c.env;

	// Fail closed in production if Access is not configured.
	if (!POLICY_AUD || !TEAM_DOMAIN) {
		return c.text(
			"Cloudflare Access must be configured in production. Set POLICY_AUD and TEAM_DOMAIN.",
			500,
		);
	}

	const token = c.req.header("cf-access-jwt-assertion");
	if (!token) {
		return c.text("Missing required CF Access JWT", 403);
	}

	try {
		const { issuer, certsUrl } = getAccessUrls(TEAM_DOMAIN);
		const { payload } = await jwtVerify(token, getJwks(certsUrl), {
			issuer,
			audience: POLICY_AUD,
		});
		const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
		if (!email) {
			// e.g. Access service tokens, which carry no user identity.
			return c.text("Access token has no user email; sign in as a user to use the inbox.", 403);
		}
		c.set("userEmail", email);
	} catch {
		return c.text("Invalid or expired Access token", 403);
	}

	return next();
});

// Mount the API routes
app.route("/", apiApp);

// React Router catch-all: serves the SPA for all non-API routes
app.all("*", (c) => {
	return requestHandler(c.req.raw, {
		cloudflare: { env: c.env, ctx: c.executionCtx as ExecutionContext },
		userEmail: c.var.userEmail,
	});
});

// Export the Hono app as the default export with an email handler
export default {
	fetch: app.fetch,
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
		try {
			await receiveEmail(message, env, ctx);
		} catch (e) {
			console.error("Failed to process incoming email:", (e as Error).message, (e as Error).stack);
			// Re-throw so Cloudflare's email routing can retry delivery or bounce the message.
			// Swallowing the error would silently drop the email.
			throw e;
		}
	},
};
