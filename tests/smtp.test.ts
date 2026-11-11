/**
 * Exercises the SMTP client and MIME builder against an in-process fake
 * SMTP server. Run with `bun test`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";
import { sendSmtp, dotStuff, type ConnectFn, type SocketLike } from "../workers/lib/smtp";
import { buildMimeMessage, encodeHeaderValue } from "../workers/lib/mime";
import { sendEmail, getSmtpConfig, EmailConfigError } from "../workers/email-sender";
import type { Env } from "../workers/types";

// ── Fake SMTP server ───────────────────────────────────────────────

interface Session {
	commands: string[];
	data: string;
	tlsUpgraded: boolean;
}

interface FakeServerOptions {
	authMethods?: string;
	starttls?: boolean;
	rejectRcpt?: string;
	rejectAuth?: boolean;
}

const servers: net.Server[] = [];
afterEach(() => {
	for (const s of servers.splice(0)) s.close();
});

function startFakeServer(opts: FakeServerOptions = {}): Promise<{ port: number; session: Session }> {
	const session: Session = { commands: [], data: "", tlsUpgraded: false };
	const server = net.createServer((sock) => {
		let buf = "";
		let inData = false;
		let authLoginStep = 0;
		const reply = (s: string) => sock.write(`${s}\r\n`);
		reply("220 fake.smtp ESMTP ready");
		sock.on("data", (chunk) => {
			buf += chunk.toString("utf8");
			while (true) {
				if (inData) {
					const end = buf.indexOf("\r\n.\r\n");
					if (end === -1) return;
					session.data = buf.slice(0, end + 2);
					buf = buf.slice(end + 5);
					inData = false;
					reply("250 2.0.0 queued as FAKE123");
					continue;
				}
				const idx = buf.indexOf("\r\n");
				if (idx === -1) return;
				const line = buf.slice(0, idx);
				buf = buf.slice(idx + 2);
				session.commands.push(line);
				const upper = line.toUpperCase();
				if (authLoginStep === 1) { authLoginStep = 2; reply("334 UGFzc3dvcmQ6"); continue; }
				if (authLoginStep === 2) { authLoginStep = 0; reply(opts.rejectAuth ? "535 bad credentials" : "235 ok"); continue; }
				if (upper.startsWith("EHLO")) {
					const ext = [`250-fake.smtp`, `250-SIZE 10485760`];
					if (opts.starttls && !session.tlsUpgraded) ext.push("250-STARTTLS");
					ext.push(`250 AUTH ${opts.authMethods ?? "PLAIN LOGIN"}`);
					sock.write(ext.join("\r\n") + "\r\n");
				} else if (upper === "STARTTLS") {
					reply("220 go ahead");
				} else if (upper.startsWith("AUTH PLAIN")) {
					reply(opts.rejectAuth ? "535 bad credentials" : "235 ok");
				} else if (upper === "AUTH LOGIN") {
					authLoginStep = 1;
					reply("334 VXNlcm5hbWU6");
				} else if (upper.startsWith("MAIL FROM")) {
					reply("250 ok");
				} else if (upper.startsWith("RCPT TO")) {
					reply(opts.rejectRcpt && line.includes(opts.rejectRcpt) ? "550 no such user" : "250 ok");
				} else if (upper === "DATA") {
					inData = true;
					reply("354 end with .");
				} else if (upper === "QUIT") {
					reply("221 bye");
					sock.end();
				} else {
					reply("500 unknown");
				}
			}
		});
	});
	servers.push(server);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({ port: (server.address() as net.AddressInfo).port, session });
		});
	});
}

/** Adapts a node:net socket to the cloudflare:sockets Socket shape. */
function nodeConnect(session?: Session): ConnectFn {
	return ({ hostname, port }) => {
		const sock = net.connect(port, hostname);
		const wrap = (): SocketLike => ({
			readable: new ReadableStream<Uint8Array>({
				start(controller) {
					sock.on("data", (d) => controller.enqueue(new Uint8Array(d)));
					sock.on("end", () => { try { controller.close(); } catch { /* already closed */ } });
					sock.on("error", (e) => controller.error(e));
				},
			}),
			writable: new WritableStream<Uint8Array>({
				write: (chunk) => new Promise((res, rej) => sock.write(chunk, (e) => (e ? rej(e) : res()))),
			}),
			close: async () => { sock.destroy(); },
			// A real TLS handshake isn't possible against the fake server; we
			// keep the same TCP stream and record that an upgrade was requested.
			startTls: () => {
				sock.removeAllListeners("data");
				sock.removeAllListeners("end");
				if (session) session.tlsUpgraded = true;
				return wrap();
			},
		});
		return wrap();
	};
}

const baseEnv = (port: number, extra: Partial<Env> = {}) =>
	({
		SMTP_HOST: "127.0.0.1",
		SMTP_PORT: String(port),
		SMTP_SECURE: "none",
		SMTP_USERNAME: "user",
		SMTP_PASSWORD: "secret",
		...extra,
	}) as unknown as Env;

// ── Tests ──────────────────────────────────────────────────────────

describe("sendSmtp", () => {
	test("delivers a message with AUTH PLAIN, all recipients and the DATA payload", async () => {
		const { port, session } = await startFakeServer();
		await sendSmtp(
			{ host: "127.0.0.1", port, secure: "none", username: "user", password: "secret" },
			{ from: "a@example.com", recipients: ["b@x.com", "c@y.com"], data: "Subject: hi\r\n\r\nbody\r\n" },
			nodeConnect(),
		);
		expect(session.commands[0]).toMatch(/^EHLO example\.com$/);
		expect(session.commands).toContain(`AUTH PLAIN ${btoa("\0user\0secret")}`);
		expect(session.commands).toContain("MAIL FROM:<a@example.com>");
		expect(session.commands).toContain("RCPT TO:<b@x.com>");
		expect(session.commands).toContain("RCPT TO:<c@y.com>");
		expect(session.data).toBe("Subject: hi\r\n\r\nbody\r\n");
	});

	test("falls back to AUTH LOGIN when PLAIN isn't offered", async () => {
		const { port, session } = await startFakeServer({ authMethods: "LOGIN" });
		await sendSmtp(
			{ host: "127.0.0.1", port, secure: "none", username: "user", password: "secret" },
			{ from: "a@example.com", recipients: ["b@x.com"], data: "x\r\n" },
			nodeConnect(),
		);
		expect(session.commands).toContain("AUTH LOGIN");
		expect(session.commands).toContain(btoa("user"));
		expect(session.commands).toContain(btoa("secret"));
	});

	test("upgrades with STARTTLS and re-sends EHLO", async () => {
		const { port, session } = await startFakeServer({ starttls: true });
		await sendSmtp(
			{ host: "127.0.0.1", port, secure: "starttls", username: "u", password: "p" },
			{ from: "a@example.com", recipients: ["b@x.com"], data: "x\r\n" },
			nodeConnect(session),
		);
		expect(session.tlsUpgraded).toBe(true);
		const ehloCount = session.commands.filter((c) => c.startsWith("EHLO")).length;
		expect(ehloCount).toBe(2);
		expect(session.commands.indexOf("STARTTLS")).toBeLessThan(session.commands.findIndex((c) => c.startsWith("AUTH")));
	});

	test("fails when STARTTLS is required but not offered", async () => {
		const { port } = await startFakeServer({ starttls: false });
		await expect(
			sendSmtp(
				{ host: "127.0.0.1", port, secure: "starttls" },
				{ from: "a@example.com", recipients: ["b@x.com"], data: "x\r\n" },
				nodeConnect(),
			),
		).rejects.toThrow(/does not support STARTTLS/);
	});

	test("surfaces authentication errors without leaking the password", async () => {
		const { port } = await startFakeServer({ rejectAuth: true });
		const err = await sendSmtp(
			{ host: "127.0.0.1", port, secure: "none", username: "user", password: "secret" },
			{ from: "a@example.com", recipients: ["b@x.com"], data: "x\r\n" },
			nodeConnect(),
		).catch((e) => e as Error);
		expect(err).toBeInstanceOf(Error);
		expect(err.message).toMatch(/535/);
		expect(err.message).not.toContain(btoa("\0user\0secret"));
	});

	test("surfaces recipient rejections", async () => {
		const { port } = await startFakeServer({ rejectRcpt: "nobody@x.com" });
		await expect(
			sendSmtp(
				{ host: "127.0.0.1", port, secure: "none" },
				{ from: "a@example.com", recipients: ["nobody@x.com"], data: "x\r\n" },
				nodeConnect(),
			),
		).rejects.toThrow(/550/);
	});

	test("rejects addresses that could inject SMTP commands", async () => {
		await expect(
			sendSmtp(
				{ host: "127.0.0.1", port: 1, secure: "none" },
				{ from: "a@example.com>\r\nRCPT TO:<evil@x.com", recipients: ["b@x.com"], data: "x" },
				nodeConnect(),
			),
		).rejects.toThrow(/Invalid email address/);
	});
});

describe("dotStuff", () => {
	test("escapes leading dots and normalises line endings", () => {
		expect(dotStuff(".hidden\nline\n..two")).toBe("..hidden\r\nline\r\n...two\r\n");
	});
});

describe("buildMimeMessage", () => {
	const decodePart = (msg: string, contentType: string) => {
		const re = new RegExp(`Content-Type: ${contentType}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+?)\\r\\n(--|$)`);
		const m = msg.match(re);
		if (!m) return null;
		const bin = atob(m[1].replace(/\r\n/g, ""));
		return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
	};

	test("builds a multipart/alternative message with required headers and no Bcc", () => {
		const msg = buildMimeMessage({
			from: { email: "alice@example.com", name: "Alice" },
			to: ["bob@x.com"],
			cc: "carol@y.com",
			subject: "Hello",
			html: "<p>Hi <b>Bob</b></p>",
			messageId: "abc@example.com",
			headers: { "In-Reply-To": "<orig@x.com>", Bcc: "should-not-appear@x.com" },
		});
		expect(msg).toContain("From: Alice <alice@example.com>\r\n");
		expect(msg).toContain("To: <bob@x.com>\r\n");
		expect(msg).toContain("Cc: <carol@y.com>\r\n");
		expect(msg).toContain("Subject: Hello\r\n");
		expect(msg).toContain("Message-ID: <abc@example.com>\r\n");
		expect(msg).toContain("In-Reply-To: <orig@x.com>\r\n");
		expect(msg).not.toMatch(/^Bcc:/im);
		expect(msg).toContain("multipart/alternative");
		expect(decodePart(msg, "text/html")).toBe("<p>Hi <b>Bob</b></p>");
		expect(decodePart(msg, "text/plain")).toBe("Hi Bob");
		// No line may exceed the RFC 5322 limit.
		for (const line of msg.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
	});

	test("encodes non-ASCII subjects and display names", () => {
		const msg = buildMimeMessage({
			from: { email: "jose@example.com", name: "José Núñez" },
			to: "bob@x.com",
			subject: "Reunión mañana ✅",
			text: "hola",
			messageId: "m@example.com",
		});
		expect(msg).toContain(`Subject: ${encodeHeaderValue("Reunión mañana ✅")}`);
		expect(msg).toMatch(/From: =\?UTF-8\?B\?.+\?= <jose@example.com>/);
		expect(decodePart(msg, "text/plain")).toBe("hola");
	});

	test("strips CR/LF from header values to prevent header injection", () => {
		const msg = buildMimeMessage({
			from: "a@example.com",
			to: "b@x.com",
			subject: "Hi\r\nBcc: victim@x.com",
			text: "x",
			messageId: "m@example.com",
		});
		expect(msg).not.toMatch(/^Bcc:/im);
	});

	test("nests inline images in multipart/related and attachments in multipart/mixed", () => {
		const msg = buildMimeMessage({
			from: "a@example.com",
			to: "b@x.com",
			subject: "Files",
			html: '<img src="cid:logo">',
			messageId: "m@example.com",
			attachments: [
				{ content: btoa("PNGDATA"), filename: "logo.png", type: "image/png", disposition: "inline", contentId: "logo" },
				{ content: btoa("PDFDATA"), filename: "report.pdf", type: "application/pdf", disposition: "attachment" },
			],
		});
		const mixed = msg.indexOf("multipart/mixed");
		const related = msg.indexOf("multipart/related");
		const alternative = msg.indexOf("multipart/alternative");
		expect(mixed).toBeGreaterThan(-1);
		expect(related).toBeGreaterThan(mixed);
		expect(alternative).toBeGreaterThan(related);
		expect(msg).toContain("Content-ID: <logo>");
		expect(msg).toContain('Content-Disposition: attachment; filename="report.pdf"');
		expect(msg).toContain(btoa("PDFDATA"));
	});
});

describe("sendEmail (end to end)", () => {
	test("builds the MIME message and sends it to To, Cc and Bcc recipients", async () => {
		const { port, session } = await startFakeServer();
		await sendEmail(
			baseEnv(port),
			{
				from: { email: "alice@example.com", name: "Alice" },
				to: "bob@x.com",
				cc: ["carol@y.com"],
				bcc: "dave@z.com",
				subject: "Quarterly report",
				html: "<p>See attached</p>",
				messageId: "id1@example.com",
			},
			nodeConnect(),
		);
		expect(session.commands).toContain("RCPT TO:<bob@x.com>");
		expect(session.commands).toContain("RCPT TO:<carol@y.com>");
		expect(session.commands).toContain("RCPT TO:<dave@z.com>");
		expect(session.data).toContain("Subject: Quarterly report");
		expect(session.data).not.toContain("dave@z.com");
	});
});

describe("getSmtpConfig", () => {
	test("defaults port by security mode", () => {
		expect(getSmtpConfig({ SMTP_HOST: "h", SMTP_SECURE: "tls" } as unknown as Env).port).toBe(465);
		expect(getSmtpConfig({ SMTP_HOST: "h", SMTP_SECURE: "starttls" } as unknown as Env).port).toBe(587);
	});
	test("rejects port 25 and missing host", () => {
		expect(() => getSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "25" } as unknown as Env)).toThrow(EmailConfigError);
		expect(() => getSmtpConfig({} as unknown as Env)).toThrow(/SMTP_HOST/);
	});
});
