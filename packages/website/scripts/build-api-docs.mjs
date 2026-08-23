// Builds the @selvajs/compute typedoc reference and copies it into static/ so
// the site serves it at /docs/api/compute. Both the typedoc output and the
// copy under static/ are gitignored — regenerated on every build.
//
// Typedoc renders a standalone page that never sees the site's Tailwind build or
// its layout, so the theming and the links back into the site are passed in here
// rather than living in packages/compute/typedoc.json: the branding is the
// website's, and the compute package shouldn't carry paths into it.
import { execSync } from 'node:child_process';
import { copyFileSync, cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const computeDir = resolve(repoRoot, 'packages/compute');
const src = resolve(computeDir, 'docs/api');
const dest = resolve(here, '../static/docs/api/compute');
const theme = resolve(here, 'api-theme/typedoc.css');
const favicon = resolve(here, '../static/favicon/favicon.svg');
const siteRoot = '/docs/api/compute/';

// Self-hosted so the reference doesn't depend on a hashed path from the
// SvelteKit build; the subset covers the Latin text typedoc emits.
const fontSrc = resolve(
	repoRoot,
	'node_modules/.pnpm/@fontsource-variable+familjen-grotesk@5.3.0/node_modules/@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-wght-normal.woff2'
);

// Root-relative so they resolve on whatever domain the site is served from.
const navigationLinks = {
	Selva: '/',
	Docs: '/docs',
	Packages: '/packages'
};

// Typedoc writes relative asset links (`assets/style.css`) resolved against the
// page's own directory. Firebase Hosting runs `trailingSlash: false`, so it
// serves a directory index at `/docs/api/compute` — with no trailing slash the
// browser resolves those links against the PARENT directory and every stylesheet,
// script, and icon 404s, leaving unstyled text. An absolute <base> pins them to
// the real directory whichever URL shape the page is reached by; `data-base` is
// the same path read by typedoc's runtime for search and nav.
function pinBase(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			pinBase(path);
		} else if (entry.name === 'index.html') {
			const base = siteRoot + relative(dest, dir).split(sep).filter(Boolean).join('/');
			const href = base.endsWith('/') ? base : base + '/';
			const html = readFileSync(path, 'utf8')
				.replace(/ data-base="[^"]*"/, ` data-base="${href}"`)
				.replace(/<head>/, `<head><base href="${href}"/>`);
			writeFileSync(path, html);
		}
	}
}

// Written next to the package's own typedoc.json and extending it, so the
// entry points and plugin list stay defined in one place. Object-valued options
// (navigationLinks) can't be passed on the command line at all.
const overrideConfig = resolve(computeDir, 'typedoc.site.json');
writeFileSync(
	overrideConfig,
	JSON.stringify(
		{
			extends: './typedoc.json',
			customCss: theme,
			favicon,
			titleLink: '/',
			navigationLinks,
			customFooterHtml:
				'<a href="/">Selva</a> \u2014 built by <a href="https://www.vektornode.com" rel="noreferrer">VektorNode</a>'
		},
		null,
		'\t'
	)
);

try {
	execSync(
		`pnpm --filter @selvajs/compute exec typedoc --options ${JSON.stringify(overrideConfig)}`,
		{
			stdio: 'inherit',
			cwd: repoRoot
		}
	);
} finally {
	rmSync(overrideConfig, { force: true });
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
copyFileSync(fontSrc, join(dest, 'assets/familjen-grotesk-latin.woff2'));
pinBase(dest);
