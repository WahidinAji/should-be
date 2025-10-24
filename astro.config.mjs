// @ts-check
import { defineConfig } from "astro/config";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";

import mdx from "@astrojs/mdx";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
	integrations: [solidJs(), mdx()],

	redirects: {
		"/contents": "/",
	},

	vite: {
		plugins: [tailwindcss()],
	},

	adapter: cloudflare(),
});
