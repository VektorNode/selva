// Overview of the @selvajs/* workspace packages, surfaced on /packages and
// previewed on the landing page. Kept as plain data so the packages page and
// the home teaser stay in sync. STRUCTURE.md is authoritative for what each
// package is; keep these descriptions consistent with it when a role changes.

import { GITHUB_URL } from './nav';

export interface PackageInfo {
	/** npm-style name shown on the card. */
	name: string;
	/** One-line role. */
	tagline: string;
	/** A sentence or two of what it's for and when you'd reach for it. */
	description: string;
	/** Grouping for the packages page layout. */
	category: 'App & UI' | 'Core libraries' | 'Providers' | 'Tooling';
	/** True when the package is published to npm (public API surface). */
	npm?: boolean;
	/** Link to the package's README on GitHub, or its npm page. */
	href: string;
	/** Short badge, e.g. the runtime or stack it targets. */
	badge?: string;
}

const repoTree = (path: string) => `${GITHUB_URL}/tree/main/${path}`;
const npmPage = (name: string) => `https://www.npmjs.com/package/${name}`;

export const packages: PackageInfo[] = [
	// ── App & UI ──────────────────────────────────────────────────────────────
	{
		name: '@selvajs/selva',
		tagline: 'The deployable web app',
		description:
			'The standalone cloud app your users visit. Loads a schema, renders the controls, and solves the definition through Rhino.Compute. Scaffolded and operated with the CLI.',
		category: 'App & UI',
		npm: true,
		href: npmPage('@selvajs/selva'),
		badge: 'SvelteKit'
	},
	{
		name: '@selvajs/plugin-ui',
		tagline: 'The schema designer',
		description:
			'The drag-and-drop UI that ships embedded in Selva.gha. Map Grasshopper parameters to web controls and preview the result live over WebSocket. Not published — it is built into the plugin.',
		category: 'App & UI',
		href: repoTree('packages/plugin-ui'),
		badge: 'Svelte'
	},
	{
		name: '@selvajs/ui',
		tagline: 'Components, theme & Svelte shells',
		description:
			'The component library, design tokens, and theme runtime shared across the app and the plugin UI. Also home to the Svelte shells over the headless cores — Viewer, SceneManager, and the useSolveSession rune wrapper.',
		category: 'App & UI',
		npm: true,
		href: npmPage('@selvajs/ui'),
		badge: 'Svelte 5'
	},

	// ── Core libraries ────────────────────────────────────────────────────────
	{
		name: '@selvajs/compute',
		tagline: 'Rhino.Compute client',
		description:
			'A type-safe Rhino.Compute client with data-tree parsing and input/output handling. Pure solve and data — no renderer, no three dependency. Browser- and Node-compatible, with modular exports for tree-shaking.',
		category: 'Core libraries',
		npm: true,
		href: npmPage('@selvajs/compute'),
		badge: 'npm'
	},
	{
		name: '@selvajs/visualization',
		tagline: 'Headless viewer core',
		description:
			'Turns a solve response into Three.js meshes and drives the CAD viewer — parse, render, and scene as three layers that depend downward only. Framework-free, with three as a peer dep, so you can build your own UI over it.',
		category: 'Core libraries',
		npm: true,
		href: npmPage('@selvajs/visualization'),
		badge: 'Three.js'
	},
	{
		name: '@selvajs/solve',
		tagline: 'The solve flow, both sides',
		description:
			'One owner for the path from an input change to a solve result. /client is a transport-free state machine (auto vs. manual, throttling, result memo); /server is the solve pipeline with its caches and single-flight. No UI, no HTTP, no renderer.',
		category: 'Core libraries',
		npm: true,
		href: npmPage('@selvajs/solve'),
		badge: 'npm'
	},
	{
		name: '@selvajs/server',
		tagline: 'HTTP request policy',
		description:
			'Transport-agnostic server pieces — request limits, the SSRF guard, rate limiting, the definition service, structured logging. Tied to no HTTP framework, and deliberately separate from the solve core in @selvajs/solve/server.',
		category: 'Core libraries',
		npm: true,
		href: npmPage('@selvajs/server'),
		badge: 'Node'
	},
	{
		name: '@selvajs/platform',
		tagline: 'Provider interfaces',
		description:
			'The auth, data, storage, and permissions interfaces (with Zod schemas) that Selva is written against. No implementations — implement these to bring your own backend, and use /testing to run the conformance suite against it.',
		category: 'Core libraries',
		npm: true,
		href: npmPage('@selvajs/platform'),
		badge: 'Interfaces'
	},
	{
		name: '@selvajs/schemas',
		tagline: 'One schema, both stacks',
		description:
			'The single ui-schema.json source of truth plus the generators that emit TypeScript types for the UI and C# types for the plugin, so the two stacks never drift.',
		category: 'Core libraries',
		npm: true,
		href: npmPage('@selvajs/schemas'),
		badge: 'Codegen'
	},

	// ── Providers ─────────────────────────────────────────────────────────────
	{
		name: '@selvajs/local-provider',
		tagline: 'Filesystem backend',
		description:
			'Zero-dependency provider: JSON on disk, HMAC sessions, atomic writes, WebP image transcoding. The default for a single box or getting started.',
		category: 'Providers',
		npm: true,
		href: npmPage('@selvajs/local-provider')
	},
	{
		name: '@selvajs/supabase-provider',
		tagline: 'Supabase backend',
		description:
			'Auth, Postgres, and Storage on Supabase, with the SQL migrations to provision it. Identity lives in Supabase; Selva keeps only session tokens and authorization data. The choice for multi-instance deployments.',
		category: 'Providers',
		npm: true,
		href: npmPage('@selvajs/supabase-provider')
	},
	{
		name: '@selvajs/header-auth-provider',
		tagline: 'Reverse-proxy identity',
		description:
			'Auth-only adapter that trusts identity headers from an upstream reverse proxy — front Selva with corporate SSO such as Entra via oauth2-proxy. Pair it with any data and storage provider.',
		category: 'Providers',
		href: repoTree('packages/providers/header-auth')
	},

	// ── Tooling ───────────────────────────────────────────────────────────────
	{
		name: '@selvajs/cli',
		tagline: 'Scaffold & operate a deployment',
		description:
			'Creates a ready-to-run deployment, prompts for provider and secrets, and ships the doctor, start, update, and key-rotation commands you operate it with.',
		category: 'Tooling',
		npm: true,
		href: npmPage('@selvajs/cli'),
		badge: 'CLI'
	},
	{
		name: '@selvajs/config',
		tagline: 'Shared build config',
		description:
			'The ESLint, Vite, and Prettier configuration every package in the monorepo extends. Internal to the workspace — listed here so the map is complete.',
		category: 'Tooling',
		href: repoTree('packages/config')
	}
];

export const packageCategories: PackageInfo['category'][] = [
	'App & UI',
	'Core libraries',
	'Providers',
	'Tooling'
];

export function packagesByCategory(): { title: PackageInfo['category']; items: PackageInfo[] }[] {
	return packageCategories.map((title) => ({
		title,
		items: packages.filter((p) => p.category === title)
	}));
}
