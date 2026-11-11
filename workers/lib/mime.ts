/**
 * Minimal RFC 5322 / MIME message builder for outbound SMTP.
 *
 * Produces a CRLF-delimited message:
 *   multipart/mixed                 (only when there are regular attachments)
 *     multipart/related             (only when there are inline attachments)
 *       multipart/alternative       (text/plain + text/html)
 *       inline parts (Content-ID)
 *     attachment parts
 *
 * All bodies are base64-encoded so no line ever exceeds 78 characters and
 * no line can begin with "." (which keeps SMTP dot-stuffing trivial).
 */

export type Address = string | { email: string; name?: string };

export interface MimeAttachment {
	/** base64-encoded content */
	content: string;
	filename: string;
	type: string;
	disposition: "attachment" | "inline";
	contentId?: string;
}

export interface MimeMessage {
	from: Address;
	to: Address | Address[];
	cc?: Address | Address[];
	subject: string;
	html?: string;
	text?: string;
	messageId: string; // without angle brackets
	date?: Date;
	replyTo?: Address;
	headers?: Record<string, string>;
	attachments?: MimeAttachment[];
}

const CRLF = "\r\n";

// ── Encoding helpers ───────────────────────────────────────────────

function utf8ToBase64(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

/** Wrap a base64 string at 76 characters per line (RFC 2045). */
function wrapBase64(b64: string): string {
	const clean = b64.replace(/\s+/g, "");
	const lines: string[] = [];
	for (let i = 0; i < clean.length; i += 76) lines.push(clean.slice(i, i + 76));
	return lines.join(CRLF);
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded-word for header values that contain non-ASCII text. */
export function encodeHeaderValue(value: string): string {
	const clean = value.replace(/[\r\n]+/g, " ");
	if (isAscii(clean)) return clean;
	// Split into chunks so each encoded-word stays under 75 chars.
	const words: string[] = [];
	let chunk = "";
	for (const ch of clean) {
		if (new TextEncoder().encode(chunk + ch).length > 45) {
			words.push(`=?UTF-8?B?${utf8ToBase64(chunk)}?=`);
			chunk = "";
		}
		chunk += ch;
	}
	if (chunk) words.push(`=?UTF-8?B?${utf8ToBase64(chunk)}?=`);
	return words.join(`${CRLF} `);
}

/** Parse "Name <a@b.c>" or "a@b.c" into its parts. */
export function parseAddress(addr: Address): { email: string; name?: string } {
	if (typeof addr !== "string") return { email: addr.email.trim(), name: addr.name?.trim() || undefined };
	const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
	if (m) return { email: m[2].trim(), name: m[1].trim() || undefined };
	return { email: addr.trim() };
}

export function formatAddress(addr: Address): string {
	const { email, name } = parseAddress(addr);
	if (!name) return `<${email}>`;
	if (isAscii(name)) {
		const quoted = /[()<>[\]:;@\\,."]/.test(name) ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;
		return `${quoted} <${email}>`;
	}
	return `${encodeHeaderValue(name)} <${email}>`;
}

export function toList(v: Address | Address[] | undefined): Address[] {
	if (!v) return [];
	if (Array.isArray(v)) return v;
	// Comma-separated string of addresses
	if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
	return [v];
}

/** Remove CR/LF from a header value to prevent header injection. */
function safeHeader(value: string): string {
	return value.replace(/[\r\n]+/g, " ");
}

function htmlToText(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function boundary(): string {
	return `----=_Part_${crypto.randomUUID().replace(/-/g, "")}`;
}

function textPart(contentType: string, body: string): string {
	return [
		`Content-Type: ${contentType}; charset=UTF-8`,
		"Content-Transfer-Encoding: base64",
		"",
		wrapBase64(utf8ToBase64(body.replace(/\r?\n/g, CRLF))),
	].join(CRLF);
}

function attachmentPart(att: MimeAttachment): string {
	const filename = safeHeader(att.filename || "attachment");
	const encodedName = isAscii(filename) && !/["\\]/.test(filename)
		? `"${filename}"`
		: `"${encodeHeaderValue(filename)}"`;
	const lines = [
		`Content-Type: ${safeHeader(att.type || "application/octet-stream")}; name=${encodedName}`,
		"Content-Transfer-Encoding: base64",
		`Content-Disposition: ${att.disposition === "inline" ? "inline" : "attachment"}; filename=${encodedName}`,
	];
	if (att.contentId) lines.push(`Content-ID: <${safeHeader(att.contentId.replace(/^<|>$/g, ""))}>`);
	lines.push("", wrapBase64(att.content));
	return lines.join(CRLF);
}

function multipart(subtype: string, parts: string[]): string {
	const b = boundary();
	return [
		`Content-Type: multipart/${subtype}; boundary="${b}"`,
		"",
		...parts.map((p) => `--${b}${CRLF}${p}`),
		`--${b}--`,
	].join(CRLF);
}

// ── Builder ────────────────────────────────────────────────────────

export function buildMimeMessage(msg: MimeMessage): string {
	const from = parseAddress(msg.from);
	const to = toList(msg.to);
	const cc = toList(msg.cc);

	const headers: string[] = [
		`From: ${formatAddress(msg.from)}`,
		`To: ${to.map(formatAddress).join(", ")}`,
	];
	if (cc.length) headers.push(`Cc: ${cc.map(formatAddress).join(", ")}`);
	// Bcc is intentionally never written to the headers.
	if (msg.replyTo) headers.push(`Reply-To: ${formatAddress(msg.replyTo)}`);
	headers.push(
		`Subject: ${encodeHeaderValue(msg.subject || "")}`,
		`Date: ${(msg.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
		`Message-ID: <${safeHeader(msg.messageId)}>`,
		"MIME-Version: 1.0",
	);
	for (const [key, value] of Object.entries(msg.headers ?? {})) {
		const k = key.replace(/[^A-Za-z0-9-]/g, "");
		if (!k || /^(from|to|cc|bcc|subject|date|message-id|mime-version|content-type)$/i.test(k)) continue;
		headers.push(`${k}: ${safeHeader(value)}`);
	}
	if (!from.email.includes("@")) throw new Error("Invalid From address");

	// Body: text + html alternative
	const html = msg.html;
	const text = msg.text ?? (html ? htmlToText(html) : "");
	let body = html
		? multipart("alternative", [textPart("text/plain", text), textPart("text/html", html)])
		: textPart("text/plain", text);

	const inline = (msg.attachments ?? []).filter((a) => a.disposition === "inline" && a.contentId);
	const regular = (msg.attachments ?? []).filter((a) => !(a.disposition === "inline" && a.contentId));

	if (inline.length) body = multipart("related", [body, ...inline.map(attachmentPart)]);
	if (regular.length) body = multipart("mixed", [body, ...regular.map(attachmentPart)]);

	return `${headers.join(CRLF)}${CRLF}${body}${CRLF}`;
}
