// Overview of the @selvajs/* workspace packages, surfaced on /packages and
// previewed on the landing page. Kept as plain data so the packages page and
// the home teaser stay in sync. Descriptions mirror the root README and
// STRUCTURE.md — update all three together if a package's role changes.

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

export const packages: PackageInfo[] = [
	// ── App & UI ──────────────────────────────────────────────────────────────
	{
		name: '@selvajs/selva',
		tagline: 'The deployable web app',
		description:
			'The standalone cloud app your users visit. Loads a schema, renders the controls, and solves the definition through Rhino.Compute. Scaffolded and operated with the CLI.',
		category: 'App & UI',
		href: repoTree('packages/selva'),
		badge: 'SvelteKit'
	},
	{
		name: '@selvajs/plugin-ui',
		tagline: 'The schema designer',
		description:
			'The drag-and-drop UI that ships embedded in Selva.gha. Map Grasshopper parameters to web controls and preview the result live over WebSocket.',
		category: 'App & UI',
		href: repoTree('packages/plugin-ui'),
		badge: 'Svelte'
	},
	{
		name: '@selvajs/ui',
		tagline: 'Shared components & theme',
		description:
			'The component library, design tokens, and theme runtime shared across the app, plugin UI, and this website. Import it to match Selva’s look.',
		category: 'App & UI',
		href: repoTree('packages/ui'),
		badge: 'Svelte'
	},

	// ── Core libraries ────────────────────────────────────────────────────────
	{
		name: '@selvajs/compute',
		tagline: 'Rhino.Compute client & 3D helpers',
		description:
			'A type-safe Rhino.Compute client with data-tree parsing and Three.js geometry conversion. Browser- and Node-compatible, with modular exports for tree-shaking. The package to reach for when embedding the viewer yourself.',
		category: 'Core libraries',
		npm: true,
		href: 'https://www.npmjs.com/package/@selvajs/compute',
		badge: 'npm'
	},
	{
		name: '@selvajs/schemas',
		tagline: 'One schema, both stacks',
		description:
			'The single ui-schema.json source of truth plus the generators that emit TypeScript types for the UI and C# types for the plugin, so the two stacks never drift.',
		category: 'Core libraries',
		href: repoTree('packages/schemas'),
		badge: 'Codegen'
	},
	{
		name: '@selvajs/server',
		tagline: 'Server building blocks',
		description:
			'Transport-agnostic server pieces — request limits, the SSRF guard, rate limiting, the definition service. Shared by the app and anyone building their own server layer.',
		category: 'Core libraries',
		href: repoTree('packages/server'),
		badge: 'Node'
	},
	{
		name: '@selvajs/platform',
		tagline: 'Provider interfaces',
		description:
			'The auth, data, storage, and permissions interfaces (with Zod schemas) that Selva is written against. No implementations — implement these to bring your own backend.',
		category: 'Core libraries',
		href: repoTree('packages/platform'),
		badge: 'Interfaces'
	},

	// ── Providers ─────────────────────────────────────────────────────────────
	{
		name: '@selvajs/local-provider',
		tagline: 'Filesystem backend',
		description:
			'Zero-dependency provider: JSON on disk, HMAC sessions, atomic writes, WebP image transcoding. The default for a single box or getting started.',
		category: 'Providers',
		href: repoTree('packages/providers/local')
	},
	{
		name: '@selvajs/supabase-provider',
		tagline: 'Supabase backend',
		description:
			'Auth, Postgres, and Storage on Supabase. Identity lives in Supabase; Selva keeps only session tokens and authorization data.',
		category: 'Providers',
		href: repoTree('packages/providers/supabase')
	},
	{
		name: '@selvajs/header-auth-provider',
		tagline: 'Reverse-proxy identity',
		description:
			'Auth-only adapter that trusts identity headers from a reverse proxy — front Selva with corporate SSO such as Entra via oauth2-proxy.',
		category: 'Providers',
		href: repoTree('packages/providers/header-auth')
	},

	// ── Tooling ───────────────────────────────────────────────────────────────
	{
		name: '@selvajs/cli',
		tagline: 'Scaffold & operate a deployment',
		description:
			'Creates a ready-to-run deployment, prompts for provider and secrets, and ships the doctor/start commands you operate it with.',
		category: 'Tooling',
		href: repoTree('packages/cli'),
		badge: 'CLI'
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
