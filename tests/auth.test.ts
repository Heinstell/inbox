import { describe, expect, test } from "bun:test";
import { canAccessMailbox, getAllowedMailboxes, isHostedAddress, isPreProvisionedAddress } from "../workers/lib/auth";
import type { Env } from "../workers/types";

const env = (extra: Record<string, unknown> = {}) =>
	({ DOMAINS: "example.com, Example.org", EMAIL_ADDRESSES: [], MAILBOX_OWNERS: {}, ...extra }) as unknown as Env;

describe("getAllowedMailboxes", () => {
	test("a user on a hosted domain gets exactly their own mailbox", () => {
		expect(getAllowedMailboxes(env(), "Alice@Example.com")).toEqual(["alice@example.com"]);
	});

	test("a user on another domain gets nothing", () => {
		expect(getAllowedMailboxes(env(), "alice@gmail.com")).toEqual([]);
	});

	test("EMAIL_ADDRESSES restricts which domain users have a mailbox", () => {
		const e = env({ EMAIL_ADDRESSES: ["alice@example.com"] });
		expect(getAllowedMailboxes(e, "alice@example.com")).toEqual(["alice@example.com"]);
		expect(getAllowedMailboxes(e, "bob@example.com")).toEqual([]);
	});

	test("MAILBOX_OWNERS maps outside identities and extra mailboxes", () => {
		const e = env({
			MAILBOX_OWNERS: {
				"Alice.Personal@gmail.com": "alice@example.com",
				"bob@example.com": ["support@example.com", "sales@example.org", "evil@notours.com"],
			},
		});
		expect(getAllowedMailboxes(e, "alice.personal@gmail.com")).toEqual(["alice@example.com"]);
		expect(getAllowedMailboxes(e, "bob@example.com")).toEqual([
			"bob@example.com",
			"sales@example.org",
			"support@example.com",
		]);
	});

	test("MAILBOX_OWNERS given as a JSON string (e.g. from a secret) also works", () => {
		const e = env({ MAILBOX_OWNERS: '{"x@gmail.com":["x@example.com"]}' });
		expect(getAllowedMailboxes(e, "x@gmail.com")).toEqual(["x@example.com"]);
	});

	test("users cannot open each other's mailboxes", () => {
		expect(canAccessMailbox(env(), "alice@example.com", "bob@example.com")).toBe(false);
		expect(canAccessMailbox(env(), "alice@example.com", "ALICE@example.com")).toBe(true);
	});
});

describe("inbound address policy", () => {
	test("hosted addresses are those on DOMAINS", () => {
		expect(isHostedAddress(env(), "x@example.org")).toBe(true);
		expect(isHostedAddress(env(), "x@other.com")).toBe(false);
	});

	test("pre-provisioned addresses come from EMAIL_ADDRESSES and MAILBOX_OWNERS", () => {
		const e = env({ EMAIL_ADDRESSES: ["a@example.com"], MAILBOX_OWNERS: { "p@gmail.com": "b@example.com" } });
		expect(isPreProvisionedAddress(e, "a@example.com")).toBe(true);
		expect(isPreProvisionedAddress(env({ MAILBOX_OWNERS: { "p@gmail.com": "b@example.com" } }), "b@example.com")).toBe(true);
		expect(isPreProvisionedAddress(env(), "random@example.com")).toBe(false);
	});
});
