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

/** The source repository, linked from the header icon and the footer. */
export const GITHUB_URL = 'https://github.com/vektornode/selva';

/** Selva is built by VektorNode — the company site the footer credits. */
export const VEKTORNODE_URL = 'https://www.vektornode.com';

/**
 * The Grasshopper plugin ships ahead of the web app: it is already on
 * Food4Rhino and in Rhino's Package Manager under the name in
 * Plugin/Selva.GH/Resources/manifest-rh*.yml.
 */
export const FOOD4RHINO_URL = 'https://www.food4rhino.com/en/app/selva';
export const YAK_PACKAGE_NAME = 'Selva';

// The company site is localised; /en is the English landing page, and contact is
// a section on it rather than its own route.
export const VEKTORNODE_CONTACT_URL = `${VEKTORNODE_URL}/en#contact`;

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
			{ label: 'Docs', href: '/docs' },
			{ label: 'Packages', href: '/packages' },
			{ label: 'Architecture', href: '/architecture' }
		]
	},
	{
		title: 'VektorNode',
		links: [
			{ label: 'Company', href: VEKTORNODE_URL, external: true },
			{ label: 'Contact', href: VEKTORNODE_CONTACT_URL, external: true },
			{ label: 'GitHub', href: 'https://github.com/vektornode', external: true },
			{ label: 'Source', href: GITHUB_URL, external: true }
		]
	}
];

// The /docs sidebar is generated from the published root docs — see lib/docs.ts.
