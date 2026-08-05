// Overview of the @selvajs/* workspace packages, surfaced on /packages and
// previewed on the landing page. Kept as plain data so the packages page and
// the home teaser stay in sync. STRUCTURE.md is authoritative for what each
// package is; keep these descriptions consistent with it when a role changes.

// Descriptions are written for someone evaluating Selva, not for someone who
// already works on it — say what the piece does, not which framework it uses.

export interface PackageInfo {
	/** Package name shown on the card. */
	name: string;
	/** One-line role. */
	tagline: string;
	/** A sentence or two of what it's for and when you'd reach for it. */
	description: string;
	/** Grouping for the packages page layout. */
	category: 'App & UI' | 'Core libraries' | 'Providers' | 'Tooling';
	/** Short badge, e.g. what the piece is. */
	badge?: string;
	/** Shown in the landing-page teaser. Keep this to a handful. */
	featured?: boolean;
}

export const packages: PackageInfo[] = [
	// ── App & UI ──────────────────────────────────────────────────────────────
	{
		name: '@selvajs/selva',
		tagline: 'The web app you deploy',
		description:
			'Where your definition actually runs. It loads the schema you saved in the .gh file, draws the controls from it, and solves through Rhino.Compute.',
		category: 'App & UI',
		badge: 'Web app',
		featured: true
	},
	{
		name: '@selvajs/plugin-ui',
		tagline: 'Where you design the interface',
		description:
			'Opens inside the Grasshopper plugin. Drag a definition parameter onto the page to turn it into a slider, dropdown, or colour picker; the layout is saved as a schema inside the .gh file itself. The preview updates live as you edit.',
		category: 'App & UI',
		badge: 'Part of the plugin',
		featured: true
	},
	{
		name: '@selvajs/ui',
		tagline: 'Buttons, inputs & theming',
		description:
			'The component library behind both the deployed site and the layout tool: the input controls, the design tokens, and the light/dark theme runtime.',
		category: 'App & UI',
		badge: 'Design system'
	},

	// ── Core libraries ────────────────────────────────────────────────────────
	{
		name: '@selvajs/compute',
		tagline: 'Type-safe Rhino.Compute client',
		description:
			'Sends inputs to a Rhino.Compute server and unpacks the results, data trees included. Both sides are typed in TypeScript, so mismatches surface while you write the code rather than at runtime. Data only; it never draws anything.',
		category: 'Core libraries',
		badge: 'TypeScript',
		featured: true
	},
	{
		name: '@selvajs/visualization',
		tagline: 'The 3D viewer',
		description:
			'Renders the geometry Rhino sends back, with camera controls, edges, a grid, and measuring. Built on Three.js and tied to no UI framework, so you can put your own interface around it.',
		category: 'Core libraries',
		badge: 'Three.js',
		featured: true
	},
	{
		name: '@selvajs/solve',
		tagline: 'Decides when to recalculate',
		description:
			'Owns everything between someone moving a slider and a new result appearing: solve on every change or only on a button press, throttling so a drag does not flood the server, and caching so an input the server has already seen comes back instantly.',
		category: 'Core libraries',
		badge: 'Client & server',
		featured: true
	},
	{
		name: '@selvajs/server',
		tagline: 'Guards incoming requests',
		description:
			'The safety layer in front of a deployment: request size limits, rate limiting to blunt abuse, an SSRF guard so a configured URL cannot be pointed at your internal network, and structured logging. Bound to no particular web framework.',
		category: 'Core libraries',
		badge: 'Node'
	},
	{
		name: '@selvajs/platform',
		tagline: 'Bring your own backend',
		description:
			'The interfaces Selva is written against for auth, data, storage, and permissions — definitions only, no implementations. Write one against your own infrastructure and run the included conformance tests to check it behaves the way Selva expects.',
		category: 'Core libraries',
		badge: 'Interfaces'
	},
	{
		name: '@selvajs/schemas',
		tagline: 'Keeps both halves in step',
		description:
			'Defines what a schema can contain — the format both halves read. One source file generates the TypeScript types the web app uses and the C# types the plugin uses, so the two stacks cannot drift apart.',
		category: 'Core libraries',
		badge: 'Code generation'
	},

	// ── Providers ─────────────────────────────────────────────────────────────
	{
		name: '@selvajs/local-provider',
		tagline: 'Everything on one machine',
		description:
			'Keeps accounts, files, and settings on the server’s own disk as plain JSON. No external service to sign up for — the default for getting started or running on a single box. Take all three roles or just one.',
		category: 'Providers',
		badge: 'Default'
	},
	{
		name: '@selvajs/supabase-provider',
		tagline: 'Hosted database & logins',
		description:
			'Puts accounts, data, and uploaded files in Supabase rather than on the server itself, with the SQL migrations to set it up. Needed when you run more than one copy of Selva at once. Usable for all three roles or only the ones you want hosted.',
		category: 'Providers',
		badge: 'Hosted'
	},
	{
		name: '@selvajs/header-auth-provider',
		tagline: 'Use your company login',
		description:
			'Hands sign-in to corporate SSO such as Entra, sitting behind a reverse proxy that vouches for the user. Sign-in only — it stores nothing, so it always pairs with one of the two above.',
		category: 'Providers',
		badge: 'Single sign-on'
	},

	// ── Tooling ───────────────────────────────────────────────────────────────
	{
		name: '@selvajs/cli',
		tagline: 'Sets up and runs your site',
		description:
			'Scaffolds a deployment, prompting for the provider and secrets it needs, and gives you the commands to start it, update it, rotate keys, and diagnose a broken install.',
		category: 'Tooling',
		badge: 'Setup tool',
		featured: true
	},
	{
		name: '@selvajs/config',
		tagline: 'Shared build settings',
		description:
			'The build and formatting settings every other package reuses. Purely internal plumbing — listed only so the map is complete.',
		category: 'Tooling',
		badge: 'Internal'
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

export const featuredPackages = packages.filter((p) => p.featured);
