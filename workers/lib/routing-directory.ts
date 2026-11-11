/**
 * Member directory built from Cloudflare Email Routing rules.
 *
 * Instead of configuring members in this app, the admin keeps using Email
 * Routing: a rule such as
 *
 *     john@heinstell.com  →  forward to  john@gmail.com
 *
 * means "john@gmail.com owns the mailbox john@heinstell.com, and gets a copy
 * of its mail". The admin DISABLES the rule so Cloudflare doesn't forward the
 * mail directly; the message then falls through to the catch-all rule, which
 * sends it to this Worker. The Worker stores it in the inbox and forwards the
 * copy itself (see receiveEmail in workers/index.ts).
 *
 * Rules are read with a read-only API token (CF_API_TOKEN) from the zone(s)
 * in CF_ZONE_ID and cached briefly per isolate.
 */
import type { Env } from "../types";

export interface RoutingDirectory {
	/** Access identity (forward destination) → mailbox addresses it may open. */
	owners: Record<string, string[]>;
	/** Mailbox address → addresses that receive a forwarded copy. */
	forwards: Record<string, string[]>;
}

export const EMPTY_DIRECTORY: RoutingDirectory = Object.freeze({ owners: {}, forwards: {} }) as RoutingDirectory;

/** Subset of the Email Routing rule object returned by the Cloudflare API. */
export interface EmailRoutingRule {
	enabled?: boolean;
	matchers?: { type?: string; field?: string; value?: string }[];
	actions?: { type?: string; value?: string[] }[];
}

const CACHE_TTL_MS = 60_000;
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Turn Email Routing rules into a directory. Only "forward" rules with a
 * literal "to" address on one of `domains` count; catch-all, Worker and drop
 * rules are ignored. Enabled and disabled rules both grant access (an enabled
 * rule just means Cloudflare delivers the mail to Gmail directly, so it
 * never reaches the inbox).
 */
export function buildDirectory(rules: EmailRoutingRule[], domains: string[]): RoutingDirectory {
	const owners: Record<string, Set<string>> = {};
	const forwards: Record<string, Set<string>> = {};

	for (const rule of rules) {
		const matcher = rule.matchers?.find((m) => m.type === "literal" && (m.field ?? "to") === "to" && m.value);
		if (!matcher?.value) continue;
		const mailbox = norm(matcher.value);
		const domain = mailbox.split("@")[1];
		if (!domain || !domains.includes(domain)) continue;

		for (const action of rule.actions ?? []) {
			if (action.type !== "forward") continue;
			for (const raw of action.value ?? []) {
				const dest = norm(raw);
				if (!dest.includes("@")) continue;
				(owners[dest] ??= new Set()).add(mailbox);
				// Never forward to an address on our own domains: it would come
				// straight back to this Worker and could loop.
				if (!domains.includes(dest.split("@")[1])) (forwards[mailbox] ??= new Set()).add(dest);
			}
		}
	}

	const toObj = (m: Record<string, Set<string>>) =>
		Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));
	return { owners: toObj(owners), forwards: toObj(forwards) };
}

function zoneIds(env: Env): string[] {
	return (env.CF_ZONE_ID || "").split(",").map((z) => z.trim()).filter(Boolean);
}

export function isDirectoryConfigured(env: Env): boolean {
	return !!env.CF_API_TOKEN && zoneIds(env).length > 0;
}

async function fetchZoneRules(zoneId: string, token: string, fetchFn: typeof fetch): Promise<EmailRoutingRule[]> {
	const rules: EmailRoutingRule[] = [];
	for (let page = 1; page <= 20; page++) {
		const res = await fetchFn(
			`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/email/routing/rules?page=${page}&per_page=50`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		const body = (await res.json().catch(() => null)) as {
			success?: boolean;
			errors?: { message?: string }[];
			result?: EmailRoutingRule[];
			result_info?: { total_pages?: number; total_count?: number; per_page?: number };
		} | null;
		if (!res.ok || !body?.success) {
			const msg = body?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
			throw new Error(`Email Routing API error for zone ${zoneId}: ${msg}`);
		}
		const batch = body.result ?? [];
		rules.push(...batch);
		const info = body.result_info;
		const totalPages = info?.total_pages
			?? (info?.total_count && info?.per_page ? Math.ceil(info.total_count / info.per_page) : undefined);
		if (batch.length === 0 || (totalPages !== undefined ? page >= totalPages : batch.length < 50)) break;
	}
	return rules;
}

let cache: { key: string; at: number; directory: RoutingDirectory } | undefined;

/** Test hook: forget the cached directory. */
export function clearDirectoryCache() {
	cache = undefined;
}

/**
 * Load the directory from the Email Routing API (cached for 60 s).
 * Returns an empty directory when CF_API_TOKEN / CF_ZONE_ID aren't set.
 * If the API fails, the last good copy is used; with no copy, it throws.
 */
export async function loadRoutingDirectory(env: Env, fetchFn: typeof fetch = fetch): Promise<RoutingDirectory> {
	if (!isDirectoryConfigured(env)) return EMPTY_DIRECTORY;

	const zones = zoneIds(env);
	const domains = (env.DOMAINS || "").split(",").map(norm).filter(Boolean);
	const key = `${zones.join(",")}|${domains.join(",")}`;
	const now = Date.now();
	if (cache && cache.key === key && now - cache.at < CACHE_TTL_MS) return cache.directory;

	try {
		const rules = (await Promise.all(zones.map((z) => fetchZoneRules(z, env.CF_API_TOKEN, fetchFn)))).flat();
		const directory = buildDirectory(rules, domains);
		cache = { key, at: now, directory };
		return directory;
	} catch (e) {
		console.error("Could not load Email Routing rules:", (e as Error).message);
		if (cache && cache.key === key) return cache.directory; // serve stale rather than lock everyone out
		throw e;
	}
}
