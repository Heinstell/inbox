/**
 * Per-user mailbox authorization.
 *
 * Every request is authenticated by Cloudflare Access (see workers/app.ts),
 * which gives us the signed-in user's identity email. A user may open:
 *
 *   1. the mailbox matching their own identity email, when that address is on
 *      one of the configured DOMAINS (and in EMAIL_ADDRESSES, if that
 *      allowlist is set), and
 *   2. any mailbox whose Email Routing rule forwards to their identity
 *      (e.g. rule john@example.com → john@gmail.com lets john@gmail.com in;
 *      see routing-directory.ts), and
 *   3. any mailbox explicitly assigned to them in MAILBOX_OWNERS (optional
 *      manual override).
 *
 * Nobody else's mailbox is reachable, not even by guessing its address.
 *
 * The functions below are pure; pass the directory from loadRoutingDirectory().
 */
import type { Env } from "../types";
import { EMPTY_DIRECTORY, type RoutingDirectory } from "./routing-directory";

export interface MailboxSettings {
	fromName?: string;
	[key: string]: unknown;
}

const norm = (s: string) => s.trim().toLowerCase();

export function getDomains(env: Env): string[] {
	return (env.DOMAINS || "").split(",").map(norm).filter(Boolean);
}

function getAllowlist(env: Env): string[] {
	return ((env.EMAIL_ADDRESSES ?? []) as string[]).map(norm).filter(Boolean);
}

function getConfiguredOwners(env: Env): Record<string, string[]> {
	// Usually a JSON-string secret; may also be an object if defined in wrangler.jsonc vars.
	let raw: unknown = (env as { MAILBOX_OWNERS?: unknown }).MAILBOX_OWNERS ?? {};
	if (typeof raw === "string") {
		try {
			raw = raw.trim() ? JSON.parse(raw) : {};
		} catch {
			console.error("MAILBOX_OWNERS is not valid JSON; ignoring it");
			raw = {};
		}
	}
	const out: Record<string, string[]> = {};
	for (const [identity, value] of Object.entries(raw as Record<string, unknown>)) {
		const list = Array.isArray(value) ? value : [value];
		out[norm(identity)] = list.filter((v): v is string => typeof v === "string").map(norm);
	}
	return out;
}

/** MAILBOX_OWNERS merged with the owners derived from Email Routing rules. */
function getOwners(env: Env, dir: RoutingDirectory): Record<string, string[]> {
	const out = getConfiguredOwners(env);
	for (const [identity, mailboxes] of Object.entries(dir.owners)) {
		out[identity] = [...new Set([...(out[identity] ?? []), ...mailboxes])];
	}
	return out;
}

/** Is this address one that this deployment may host a mailbox for? */
export function isHostedAddress(env: Env, address: string): boolean {
	const addr = norm(address);
	const domain = addr.split("@")[1];
	if (!domain || !getDomains(env).includes(domain)) return false;
	const allowlist = getAllowlist(env);
	return allowlist.length === 0 || allowlist.includes(addr);
}

/**
 * Addresses whose mailbox is created on first inbound email, even before the
 * owner has signed in: everything in EMAIL_ADDRESSES, MAILBOX_OWNERS and the
 * Email Routing forwarding rules.
 */
export function isPreProvisionedAddress(env: Env, address: string, dir: RoutingDirectory = EMPTY_DIRECTORY): boolean {
	const addr = norm(address);
	if (!isHostedAddress(env, addr)) return false;
	if (getAllowlist(env).includes(addr)) return true;
	return Object.values(getOwners(env, dir)).some((list) => list.includes(addr));
}

/** Mailboxes the given Access identity is allowed to open. */
export function getAllowedMailboxes(env: Env, identityEmail: string, dir: RoutingDirectory = EMPTY_DIRECTORY): string[] {
	const identity = norm(identityEmail);
	const result = new Set<string>();
	if (isHostedAddress(env, identity)) result.add(identity);
	for (const addr of getOwners(env, dir)[identity] ?? []) {
		if (isHostedAddress(env, addr)) result.add(addr);
	}
	return [...result].sort();
}

export function canAccessMailbox(env: Env, identityEmail: string, mailboxId: string, dir: RoutingDirectory = EMPTY_DIRECTORY): boolean {
	return getAllowedMailboxes(env, identityEmail, dir).includes(norm(mailboxId));
}

export function defaultMailboxSettings(address: string) {
	return {
		fromName: address.split("@")[0] || address,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
	};
}

/** Create the mailbox record in R2 and initialise its Durable Object if needed. */
export async function ensureMailbox(env: Env, address: string): Promise<void> {
	const addr = norm(address);
	const key = `mailboxes/${addr}.json`;
	if (await env.BUCKET.head(key)) return;
	await env.BUCKET.put(key, JSON.stringify(defaultMailboxSettings(addr)));
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(addr));
	await stub.getFolders(); // runs migrations and creates the default folders
}
