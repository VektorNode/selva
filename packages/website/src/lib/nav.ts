// Shared navigation data for the header, footer, and docs sidebar.
// Single source of truth so links stay consistent across the site.

export interface NavLink {
	label: string;
	href: string;
	/** External links open in a new tab and skip SvelteKit routing. */
	external?: boolean;
}

export interface NavSection {
	title: string;
	links: NavLink[];
}

// The repository is private until the first public release, so nothing links to
// it yet. Restore the GitHub entries in primaryNav/footerNav and the source
// links in packages.ts when it goes public.
export const GITHUB_URL = 'https://github.com/vektornode/selva';

/** Primary navigation shown in the site header. */
export const primaryNav: NavLink[] = [
	{ label: 'Docs', href: '/docs' },
	{ label: 'Packages', href: '/packages' },
	{ label: 'Architecture', href: '/architecture' }
];

/** Grouped links shown in the site footer. */
export const footerNav: NavSection[] = [
	{
		title: 'Product',
		links: [
			{ label: 'Overview', href: '/' },
			{ label: 'Documentation', href: '/docs' },
			{ label: 'Packages', href: '/packages' },
			{ label: 'Architecture', href: '/architecture' }
		]
	},
	{
		title: 'Resources',
		links: [{ label: 'What is Selva', href: '/docs/what-is-selva' }]
	}
];

// The /docs sidebar is generated from the published root docs — see lib/docs.ts.
