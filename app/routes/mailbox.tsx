// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet, useParams } from "react-router";
import type { Route } from "./+types/mailbox";
import { canAccessMailbox } from "../../workers/lib/auth";
import { loadRoutingDirectory } from "../../workers/lib/routing-directory";
import ComposeEmail from "~/components/ComposeEmail";
import Header from "~/components/Header";
import Sidebar from "~/components/Sidebar";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

/**
 * Server-side guard: runs on the Worker for every page load and in-app
 * navigation under /mailbox/:mailboxId. Mailboxes the signed-in user doesn't
 * own get a 404 page, so they can't even open the (empty) mailbox shell.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
	const { env } = context.cloudflare;
	const userEmail = context.userEmail;
	if (!userEmail) throw new Response("Not signed in", { status: 401 });
	const mailboxId = decodeURIComponent(params.mailboxId).toLowerCase();
	const directory = await loadRoutingDirectory(env);
	if (!canAccessMailbox(env, userEmail, mailboxId, directory)) {
		throw new Response("Not Found", { status: 404 });
	}
	return null;
}

export default function MailboxRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	// Prefetch mailbox data for child components
	useMailbox(mailboxId);
	const prevMailboxIdRef = useRef<string | undefined>(undefined);
	const {
		isSidebarOpen,
		closeSidebar,
		closePanel,
		closeComposeModal,
	} = useUIStore();

	useEffect(() => {
		if (
			prevMailboxIdRef.current &&
			mailboxId &&
			prevMailboxIdRef.current !== mailboxId
		) {
			closePanel();
			closeComposeModal();
			closeSidebar();
		}

		prevMailboxIdRef.current = mailboxId;
	}, [mailboxId, closeComposeModal, closePanel, closeSidebar]);

	return (
		<div className="flex h-screen overflow-hidden">
			{/* Mobile sidebar overlay backdrop */}
			{isSidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/30 md:hidden"
					onClick={closeSidebar}
					onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
					role="button"
					tabIndex={-1}
					aria-label="Close sidebar"
				/>
			)}

			{/* Sidebar: hidden on mobile by default, shown as overlay when open */}
			<div
				className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:z-0 ${
					isSidebarOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<Sidebar />
			</div>

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0 bg-kumo-base">
				<Header />
				<main className="flex-1 overflow-hidden">
					<Outlet />
				</main>
			</div>

			<ComposeEmail />
		</div>
	);
}
