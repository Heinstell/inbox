// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import type { EmailFull } from "../lib/schemas";
import { buildReferencesChain, resolveOriginalEmail } from "../lib/email-helpers";
import { SendEmailRequestSchema } from "../lib/schemas";
import { deliverAndStore } from "../lib/outbound";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

export async function handleReplyEmail(c: AppContext) {
	const mailboxId = c.var.mailboxId;
	const body = SendEmailRequestSchema.parse(await c.req.json());

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(c.req.param("id") ?? "")) as EmailFull | null;
	if (!rawOriginal) return c.json({ error: "Original email not found" }, 404);

	const originalEmail = await resolveOriginalEmail(stub, rawOriginal);
	const { originalMsgId, references, threadId } = buildReferencesChain(originalEmail);

	const res = await deliverAndStore(c, mailboxId, body, {
		inReplyTo: originalMsgId,
		references,
		threadId,
	});
	if (res.status < 300) await stub.markThreadRead(threadId);
	return res;
}

export async function handleForwardEmail(c: AppContext) {
	const mailboxId = c.var.mailboxId;
	const body = SendEmailRequestSchema.parse(await c.req.json());

	const stub = c.var.mailboxStub;
	const rawOriginal = (await stub.getEmail(c.req.param("id") ?? "")) as EmailFull | null;
	if (!rawOriginal) return c.json({ error: "Original email not found" }, 404);

	// Forwards start a new thread.
	return deliverAndStore(c, mailboxId, body, { inReplyTo: null, references: [], threadId: null });
}
