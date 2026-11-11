/**
 * Minimal SMTP client for Cloudflare Workers, built on TCP sockets
 * (`cloudflare:sockets`). Works with any authenticated SMTP relay such as
 * SMTP2GO, Mailgun, Postmark, Amazon SES, Brevo, Fastmail, etc.
 *
 * Supports:
 *   - implicit TLS ("tls", typically port 465)
 *   - STARTTLS     ("starttls", typically port 587 or 2525)
 *   - plaintext    ("none", local testing only)
 *   - AUTH PLAIN and AUTH LOGIN
 *
 * Note: Cloudflare Workers cannot open outbound connections on port 25.
 */

export type SmtpSecurity = "tls" | "starttls" | "none";

export interface SmtpConfig {
	host: string;
	port: number;
	secure: SmtpSecurity;
	username?: string;
	password?: string;
	/** Hostname announced in EHLO. Defaults to the sender's domain. */
	clientName?: string;
	/** Overall timeout for one send, in ms. */
	timeoutMs?: number;
}

export interface SmtpEnvelope {
	from: string;
	recipients: string[];
	/** Full RFC 5322 message with CRLF line endings. */
	data: string;
}

/** The subset of the `cloudflare:sockets` Socket API used here. */
export interface SocketLike {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	close(): Promise<void>;
	startTls(): SocketLike;
}

export type ConnectFn = (
	address: { hostname: string; port: number },
	options: { secureTransport: "on" | "off" | "starttls"; allowHalfOpen: boolean },
) => SocketLike;

export class SmtpError extends Error {
	constructor(message: string, public code?: number) {
		super(message);
		this.name = "SmtpError";
	}
}

interface SmtpResponse {
	code: number;
	lines: string[];
}

class SmtpConnection {
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private buffer = "";
	private decoder = new TextDecoder();
	private encoder = new TextEncoder();

	constructor(public socket: SocketLike) {
		this.reader = socket.readable.getReader();
		this.writer = socket.writable.getWriter();
	}

	async upgradeTls(): Promise<void> {
		this.reader.releaseLock();
		this.writer.releaseLock();
		this.socket = this.socket.startTls();
		this.reader = this.socket.readable.getReader();
		this.writer = this.socket.writable.getWriter();
		this.buffer = "";
	}

	private async readLine(): Promise<string> {
		while (true) {
			const idx = this.buffer.indexOf("\r\n");
			if (idx !== -1) {
				const line = this.buffer.slice(0, idx);
				this.buffer = this.buffer.slice(idx + 2);
				return line;
			}
			const { value, done } = await this.reader.read();
			if (done) throw new SmtpError("SMTP connection closed unexpectedly");
			this.buffer += this.decoder.decode(value, { stream: true });
		}
	}

	async readResponse(): Promise<SmtpResponse> {
		const lines: string[] = [];
		while (true) {
			const line = await this.readLine();
			const m = line.match(/^(\d{3})([ -])(.*)$/);
			if (!m) throw new SmtpError(`Malformed SMTP response: ${line}`);
			lines.push(m[3]);
			if (m[2] === " ") return { code: Number(m[1]), lines };
		}
	}

	async write(data: string): Promise<void> {
		await this.writer.write(this.encoder.encode(data));
	}

	async command(cmd: string, expected: number | number[], redact = false): Promise<SmtpResponse> {
		await this.write(`${cmd}\r\n`);
		const res = await this.readResponse();
		expect(res, expected, redact ? cmd.split(" ")[0] : cmd);
		return res;
	}

	async close(): Promise<void> {
		try {
			this.reader.releaseLock();
			this.writer.releaseLock();
		} catch { /* ignore */ }
		try {
			await this.socket.close();
		} catch { /* ignore */ }
	}
}

function expect(res: SmtpResponse, expected: number | number[], context: string) {
	const ok = Array.isArray(expected) ? expected.includes(res.code) : res.code === expected;
	if (!ok) {
		throw new SmtpError(`SMTP ${context} failed: ${res.code} ${res.lines.join(" ")}`, res.code);
	}
}

/** Apply SMTP dot-stuffing and make sure the payload ends in CRLF. */
export function dotStuff(data: string): string {
	let out = data.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
	if (!out.endsWith("\r\n")) out += "\r\n";
	return out;
}

function toBase64(s: string): string {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

function assertSafeAddress(addr: string) {
	if (/[\r\n<>]/.test(addr) || !addr.includes("@")) {
		throw new SmtpError(`Invalid email address: ${addr}`);
	}
}

async function defaultConnect(): Promise<ConnectFn> {
	const { connect } = await import("cloudflare:sockets");
	return connect as unknown as ConnectFn;
}

export async function sendSmtp(
	config: SmtpConfig,
	envelope: SmtpEnvelope,
	connectFn?: ConnectFn,
): Promise<void> {
	assertSafeAddress(envelope.from);
	if (envelope.recipients.length === 0) throw new SmtpError("No recipients");
	envelope.recipients.forEach(assertSafeAddress);

	const connect = connectFn ?? (await defaultConnect());
	const socket = connect(
		{ hostname: config.host, port: config.port },
		{
			secureTransport: config.secure === "tls" ? "on" : config.secure === "starttls" ? "starttls" : "off",
			allowHalfOpen: false,
		},
	);
	const conn = new SmtpConnection(socket);
	const clientName = config.clientName || envelope.from.split("@")[1] || "localhost";

	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new SmtpError(`SMTP timed out after ${config.timeoutMs ?? 30_000}ms`)),
			config.timeoutMs ?? 30_000,
		);
	});

	const session = async () => {
		expect(await conn.readResponse(), 220, "greeting");

		let ehlo = await conn.command(`EHLO ${clientName}`, 250);

		if (config.secure === "starttls") {
			if (!ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) {
				throw new SmtpError("SMTP server does not support STARTTLS");
			}
			await conn.command("STARTTLS", 220);
			await conn.upgradeTls();
			ehlo = await conn.command(`EHLO ${clientName}`, 250);
		}

		if (config.username) {
			const authLine = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) ?? "";
			const methods = authLine.toUpperCase().split(/[\s=]+/).slice(1);
			const password = config.password ?? "";
			if (methods.includes("PLAIN") || methods.length === 0) {
				await conn.command(`AUTH PLAIN ${toBase64(`\0${config.username}\0${password}`)}`, 235, true);
			} else if (methods.includes("LOGIN")) {
				await conn.command("AUTH LOGIN", 334);
				await conn.command(toBase64(config.username), 334, true);
				await conn.command(toBase64(password), 235, true);
			} else {
				throw new SmtpError(`No supported SMTP AUTH method (server offers: ${methods.join(", ")})`);
			}
		}

		await conn.command(`MAIL FROM:<${envelope.from}>`, 250);
		for (const rcpt of envelope.recipients) {
			await conn.command(`RCPT TO:<${rcpt}>`, [250, 251]);
		}
		await conn.command("DATA", 354);
		await conn.write(dotStuff(envelope.data));
		await conn.command(".", 250);
		try {
			await conn.command("QUIT", 221);
		} catch { /* the message is already accepted */ }
	};

	try {
		await Promise.race([session(), timeout]);
	} catch (e) {
		if (e instanceof SmtpError) throw e;
		throw new SmtpError(`Could not talk to ${config.host}:${config.port}: ${(e as Error).message}`);
	} finally {
		clearTimeout(timer);
		await conn.close();
	}
}
