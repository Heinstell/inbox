// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Loader } from "@cloudflare/kumo";
import { EnvelopeIcon, SignOutIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { useMailboxes, useMe } from "~/queries/mailboxes";

export function meta() {
	return [{ title: "Inbox" }];
}

const LOGOUT_URL = "/cdn-cgi/access/logout";

export default function HomeRoute() {
	const navigate = useNavigate();
	const { data: me, error: meError, isLoading: meLoading } = useMe();
	const { data: mailboxes = [], isLoading: mailboxesLoading } = useMailboxes();

	// Users with exactly one mailbox go straight to their inbox.
	useEffect(() => {
		if (mailboxes.length === 1) {
			navigate(`/mailbox/${encodeURIComponent(mailboxes[0].id)}/emails/inbox`, { replace: true });
		}
	}, [mailboxes, navigate]);

	if (meLoading || mailboxesLoading || mailboxes.length === 1) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-kumo-recessed">
				<Loader size="lg" />
			</div>
		);
	}

	if (meError || !me) {
		return (
			<Centered
				title="You're not signed in"
				message={(meError as Error | null)?.message || "Sign in through Cloudflare Access to view your inbox."}
			/>
		);
	}

	if (mailboxes.length === 0) {
		return (
			<Centered
				title="No mailbox for this account"
				message={`You're signed in as ${me.email}, but no mailbox is assigned to that identity. Ask your administrator to create an Email Routing rule that forwards your work address to ${me.email}. It can take up to a minute to take effect.`}
				showSignOut
			/>
		);
	}

	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8 flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-kumo-default">Your mailboxes</h1>
						<p className="text-sm text-kumo-subtle mt-1">Signed in as {me.email}</p>
					</div>
					<SignOutButton />
				</div>
				<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
					{mailboxes.map((account, idx) => (
						<RouterLink
							key={account.id}
							to={`/mailbox/${encodeURIComponent(account.id)}/emails/inbox`}
							className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint ${
								idx > 0 ? "border-t border-kumo-line" : ""
							}`}
						>
							<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
								{(account.name || account.email).charAt(0).toUpperCase()}
							</div>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium text-kumo-default truncate">{account.name}</div>
								<div className="text-sm text-kumo-subtle">{account.email}</div>
							</div>
						</RouterLink>
					))}
				</div>
			</div>
		</div>
	);
}

function SignOutButton() {
	return (
		<Button
			variant="secondary"
			size="sm"
			icon={<SignOutIcon size={16} />}
			onClick={() => {
				window.location.href = LOGOUT_URL;
			}}
		>
			Sign out
		</Button>
	);
}

function Centered({ title, message, showSignOut }: { title: string; message: string; showSignOut?: boolean }) {
	return (
		<div className="min-h-screen bg-kumo-recessed flex items-center justify-center px-4">
			<div className="max-w-md rounded-xl border border-kumo-line bg-kumo-base py-12 px-6 text-center">
				<EnvelopeIcon size={48} weight="thin" className="text-kumo-subtle mx-auto mb-4" />
				<h1 className="text-base font-semibold text-kumo-default mb-1.5">{title}</h1>
				<p className="text-sm text-kumo-subtle mb-5">{message}</p>
				{showSignOut && <SignOutButton />}
			</div>
		</div>
	);
}
