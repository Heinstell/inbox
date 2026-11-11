// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
  // Pre-bundle client dependencies on startup. Without this Vite discovers them
  // lazily on the first page load, re-optimizes and reloads mid-request, and the
  // browser can end up with two React copies ("Invalid hook call" / useState errors).
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router",
      "@cloudflare/kumo",
      "@phosphor-icons/react",
      "@tanstack/react-query",
      "zustand",
      "dompurify",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/extension-color",
      "@tiptap/extension-highlight",
      "@tiptap/extension-image",
      "@tiptap/extension-link",
      "@tiptap/extension-text-align",
      "@tiptap/extension-text-style",
      "@tiptap/extension-underline",
    ],
  },
});
