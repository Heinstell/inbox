/**
 * Shared send pipeline for new emails, replies and forwards:
 *   validate sender → rate limit → deliver over SMTP → store in Sent.
 *
 * Delivery happens before storage so a failed send is reported to the user
 * instead of silently appearing in the Sent folder.
 */
import type { Context } from "hono";
import type { z } from "zod";
import { sendEmail, EmailConfigError, SmtpError } from "../email-sender";
import { storeAttachments } from "./attachments";
import { validateSender, SenderValidationError, generateMessageId, buildThreadingHeaders } from "./email-helpers";
import type { SendEmailRequestSchema } from "./schemas";
import type { MailboxContext } from "./mailbox";
import { Folders } from "../../shared/folders";

type AppContext = Context<MailboxContext>;
type SendRequest = z.infer<typeof SendEmailRequestSchema>;
type RateLimitStub = { checkSendRateLimit: () => Promise<string | null> };

export interface Threading {
	inReplyTo: string | null;
	references: string[];
	threadId: string | null;
}

const joinList = (v?: string | string[]) => (v ? (Array.isArray(v) ? v.join(", ") : v) : undefined);

export async function deliverAndStore(
	c: AppContext,
	mailboxId: string,
	body: SendRequest,
	threading: Threading,
) {
	const { to, cc, bcc, from, subject, html, text, attachments } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as unknown as RateLimitStub).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const threadingHeaders = threading.inReplyTo
		? buildThreadingHeaders(threading.inReplyTo, threading.references)
		: undefined;

	try {
		await sendEmail(c.env, {
			to, cc, bcc, from, subject, html, text,
			messageId: outgoingMessageId,
			headers: threadingHeaders,
			attachments: attachments?.map((att) => ({
				content: att.content,
				filename: att.filename,
				type: att.type,
				disposition: att.disposition || "attachment",
				contentId: att.contentId,
			})),
		});
	} catch (e) {
		const message = (e as Error).message;
		console.error("Email delivery failed:", message);
		if (e instanceof EmailConfigError) return c.json({ error: message }, 500);
		if (e instanceof SmtpError) return c.json({ error: `Could not send email: ${message}` }, 502);
		return c.json({ error: "Could not send email: unexpected error contacting the SMTP server" }, 502);
	}

	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);
	const now = new Date().toISOString();
	const threadId = threading.threadId || threading.inReplyTo || messageId;

	await stub.createEmail(Folders.SENT, {
		id: messageId,
		subject,
		sender: fromEmail,
		recipient: toStr,
		cc: joinList(cc)?.toLowerCase() ?? null,
		bcc: joinList(bcc)?.toLowerCase() ?? null,
		date: now,
		body: html || text || "",
		in_reply_to: threading.inReplyTo,
		email_references: threading.references.length ? JSON.stringify(threading.references) : null,
		thread_id: threadId,
		message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: joinList(to) },
			...(cc ? [{ key: "cc", value: joinList(cc) }] : []),
			...(bcc ? [{ key: "bcc", value: joinList(bcc) }] : []),
			{ key: "subject", value: subject },
			{ key: "date", value: now },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
			...(threadingHeaders
				? Object.entries(threadingHeaders).map(([key, value]) => ({ key: key.toLowerCase(), value }))
				: []),
		]),
	}, attachmentData);

	return c.json({ id: messageId, status: "sent", threadId }, 201);
}
