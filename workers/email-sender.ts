/**
 * Outbound email delivery through a custom SMTP relay (e.g. SMTP2GO).
 *
 * Configuration comes from Worker vars/secrets:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE ("tls" | "starttls" | "none"),
 *   SMTP_USERNAME, SMTP_PASSWORD
 */
import { buildMimeMessage, parseAddress, toList, type Address, type MimeAttachment } from "./lib/mime";
import { sendSmtp, SmtpError, type ConnectFn, type SmtpConfig, type SmtpSecurity } from "./lib/smtp";
import type { Env } from "./types";

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: MimeAttachment[];
	headers?: Record<string, string>;
	/** RFC 5322 Message-ID, without angle brackets. */
	messageId: string;
}

export class EmailConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmailConfigError";
	}
}

export function getSmtpConfig(env: Env): SmtpConfig {
	const host = env.SMTP_HOST?.trim();
	if (!host) throw new EmailConfigError("SMTP is not configured: set SMTP_HOST");
	const secure = (env.SMTP_SECURE?.trim().toLowerCase() || "tls") as SmtpSecurity;
	if (!["tls", "starttls", "none"].includes(secure)) {
		throw new EmailConfigError(`Invalid SMTP_SECURE "${env.SMTP_SECURE}": use tls, starttls or none`);
	}
	const port = Number(env.SMTP_PORT || (secure === "tls" ? 465 : 587));
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new EmailConfigError(`Invalid SMTP_PORT "${env.SMTP_PORT}"`);
	}
	if (port === 25) {
		throw new EmailConfigError("Cloudflare Workers cannot connect to port 25. Use 465, 587 or 2525.");
	}
	return {
		host,
		port,
		secure,
		username: env.SMTP_USERNAME || undefined,
		password: env.SMTP_PASSWORD || undefined,
	};
}

/**
 * Build the MIME message and deliver it over SMTP.
 * Throws SmtpError / EmailConfigError on failure.
 */
export async function sendEmail(
	env: Env,
	params: SendEmailParams,
	connectFn?: ConnectFn,
): Promise<{ messageId: string }> {
	const config = getSmtpConfig(env);
	const addrs = (v: Address | Address[] | undefined) => toList(v).map((a) => parseAddress(a).email);
	const recipients = [...new Set([...addrs(params.to), ...addrs(params.cc), ...addrs(params.bcc)])];
	const from = parseAddress(params.from).email;

	const data = buildMimeMessage({
		from: params.from,
		to: params.to,
		cc: params.cc,
		subject: params.subject,
		html: params.html,
		text: params.text,
		replyTo: params.replyTo,
		headers: params.headers,
		attachments: params.attachments,
		messageId: params.messageId,
	});

	await sendSmtp({ ...config, clientName: from.split("@")[1] }, { from, recipients, data }, connectFn);
	return { messageId: params.messageId };
}

export { SmtpError };
