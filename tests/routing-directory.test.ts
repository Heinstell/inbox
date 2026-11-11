import { beforeEach, describe, expect, test } from "bun:test";
import {
	buildDirectory,
	clearDirectoryCache,
	loadRoutingDirectory,
	type EmailRoutingRule,
} from "../workers/lib/routing-directory";
import { canAccessMailbox, getAllowedMailboxes, isPreProvisionedAddress } from "../workers/lib/auth";
import type { Env } from "../workers/types";

const forwardRule = (to: string, dest: string | string[], enabled = false): EmailRoutingRule => ({
	enabled,
	matchers: [{ type: "literal", field: "to", value: to }],
	actions: [{ type: "forward", value: Array.isArray(dest) ? dest : [dest] }],
});

const RULES: EmailRoutingRule[] = [
	forwardRule("John@Example.com", "John@Gmail.com"),
	forwardRule("mary@example.com", "mary@outlook.com", true),
	forwardRule("team@example.com", ["john@gmail.com", "mary@outlook.com"]),
	forwardRule("alias@example.com", "john@example.com"), // internal: no forward (loop guard)
	forwardRule("x@otherdomain.com", "x@gmail.com"), // not one of our DOMAINS
	{ enabled: true, matchers: [{ type: "all" }], actions: [{ type: "worker", value: ["agentic-inbox"] }] }, // catch-all
	{ enabled: true, matchers: [{ type: "literal", field: "to", value: "spam@example.com" }], actions: [{ type: "drop" }] },
];

describe("buildDirectory", () => {
	const dir = buildDirectory(RULES, ["example.com"]);

	test("maps forward destinations to the mailboxes they own (enabled or not)", () => {
		expect(dir.owners["john@gmail.com"]).toEqual(["john@example.com", "team@example.com"]);
		expect(dir.owners["mary@outlook.com"]).toEqual(["mary@example.com", "team@example.com"]);
	});

	test("records where each mailbox forwards copies", () => {
		expect(dir.forwards["john@example.com"]).toEqual(["john@gmail.com"]);
		expect(dir.forwards["team@example.com"]).toEqual(["john@gmail.com", "mary@outlook.com"]);
	});

	test("ignores other domains, catch-all, worker and drop rules", () => {
		expect(dir.owners["x@gmail.com"]).toBeUndefined();
		expect(dir.forwards["spam@example.com"]).toBeUndefined();
	});

	test("never forwards to our own domains (would loop back to the Worker)", () => {
		expect(dir.forwards["alias@example.com"]).toBeUndefined();
		expect(dir.owners["john@example.com"]).toEqual(["alias@example.com"]);
	});
});

describe("auth with the directory", () => {
	const env = { DOMAINS: "example.com", EMAIL_ADDRESSES: [], MAILBOX_OWNERS: {} } as unknown as Env;
	const dir = buildDirectory(RULES, ["example.com"]);

	test("a Gmail identity opens exactly the mailboxes forwarded to it", () => {
		expect(getAllowedMailboxes(env, "john@gmail.com", dir)).toEqual(["john@example.com", "team@example.com"]);
		expect(canAccessMailbox(env, "john@gmail.com", "mary@example.com", dir)).toBe(false);
		expect(getAllowedMailboxes(env, "stranger@gmail.com", dir)).toEqual([]);
	});

	test("forwarded mailboxes accept mail before their owner signs in", () => {
		expect(isPreProvisionedAddress(env, "john@example.com", dir)).toBe(true);
		expect(isPreProvisionedAddress(env, "nobody@example.com", dir)).toBe(false);
	});

	test("MAILBOX_OWNERS is merged with the directory", () => {
		const e = { ...env, MAILBOX_OWNERS: { "john@gmail.com": ["extra@example.com"] } } as unknown as Env;
		expect(getAllowedMailboxes(e, "john@gmail.com", dir)).toEqual([
			"extra@example.com",
			"john@example.com",
			"team@example.com",
		]);
	});
});

describe("loadRoutingDirectory", () => {
	const env = { DOMAINS: "example.com", CF_API_TOKEN: "tok", CF_ZONE_ID: "zone1" } as unknown as Env;
	beforeEach(() => clearDirectoryCache());

	const apiResponse = (result: EmailRoutingRule[], page: number, totalPages: number) =>
		new Response(JSON.stringify({ success: true, errors: [], result, result_info: { page, total_pages: totalPages } }), {
			headers: { "Content-Type": "application/json" },
		});

	test("returns an empty directory when not configured", async () => {
		let called = false;
		const dir = await loadRoutingDirectory({ DOMAINS: "example.com" } as unknown as Env, (async () => {
			called = true;
			return new Response("{}");
		}) as unknown as typeof fetch);
		expect(dir.owners).toEqual({});
		expect(called).toBe(false);
	});

	test("pages through the API with the token and caches the result", async () => {
		const calls: { url: string; auth: string | null }[] = [];
		const fetchFn = (async (url: string, init?: RequestInit) => {
			calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
			const page = Number(new URL(url).searchParams.get("page"));
			return page === 1
				? apiResponse([forwardRule("john@example.com", "john@gmail.com")], 1, 2)
				: apiResponse([forwardRule("mary@example.com", "mary@outlook.com")], 2, 2);
		}) as unknown as typeof fetch;

		const dir = await loadRoutingDirectory(env, fetchFn);
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
			"/client/v4/zones/zone1/email/routing/rules",
			"/client/v4/zones/zone1/email/routing/rules",
		]);
		expect(calls[0].auth).toBe("Bearer tok");
		expect(dir.owners["mary@outlook.com"]).toEqual(["mary@example.com"]);

		await loadRoutingDirectory(env, fetchFn);
		expect(calls.length).toBe(2); // served from cache
	});

	test("throws a useful error when the API rejects the token", async () => {
		const fetchFn = (async () =>
			new Response(JSON.stringify({ success: false, errors: [{ message: "Authentication error" }] }), { status: 403 })) as unknown as typeof fetch;
		await expect(loadRoutingDirectory(env, fetchFn)).rejects.toThrow(/Authentication error/);
	});
});
