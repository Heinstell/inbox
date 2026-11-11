// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware for every /api/v1/mailboxes/:mailboxId route.
 *
 * 1. Checks that the signed-in user (set by the Access middleware in
 *    workers/app.ts) is allowed to open this mailbox.
 * 2. Creates the mailbox on first use.
 * 3. Attaches the Durable Object stub to the context (`c.var.mailboxStub`).
 */
import { createMiddleware } from "hono/factory";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import { canAccessMailbox, ensureMailbox } from "./auth";
import { loadRoutingDirectory } from "./routing-directory";

export type AppVariables = {
	/** Identity email of the signed-in Cloudflare Access user. */
	userEmail: string;
};

export type MailboxContext = {
	Bindings: Env;
	Variables: AppVariables & {
		mailboxId: string;
		mailboxStub: DurableObjectStub<MailboxDO>;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	const mailboxId = decodeURIComponent(rawId).toLowerCase();

	const userEmail = c.var.userEmail;
	if (!userEmail) return c.json({ error: "Not signed in" }, 401);

	// Respond 404 rather than 403 so mailbox addresses can't be enumerated.
	const directory = await loadRoutingDirectory(c.env);
	if (!canAccessMailbox(c.env, userEmail, mailboxId, directory)) {
		return c.json({ error: "Not found" }, 404);
	}

	await ensureMailbox(c.env, mailboxId);

	const ns = c.env.MAILBOX;
	c.set("mailboxId", mailboxId);
	c.set("mailboxStub", ns.get(ns.idFromName(mailboxId)));

	await next();
});
