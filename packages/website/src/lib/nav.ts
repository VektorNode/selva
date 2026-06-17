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

export const GITHUB_URL = 'https://github.com/vektornode/selva';

/** Primary navigation shown in the site header. */
export const primaryNav: NavLink[] = [
	{ label: 'Docs', href: '/docs' },
	{ label: 'GitHub', href: GITHUB_URL, external: true }
];

/** Grouped links shown in the site footer. */
export const footerNav: NavSection[] = [
	{
		title: 'Product',
		links: [
			{ label: 'Overview', href: '/' },
			{ label: 'Documentation', href: '/docs' }
		]
	},
	{
		title: 'Resources',
		links: [
			{ label: 'GitHub', href: GITHUB_URL, external: true },
			{ label: 'Issues', href: `${GITHUB_URL}/issues`, external: true }
		]
	}
];

// The /docs sidebar is generated from the published root docs — see lib/docs.ts.
