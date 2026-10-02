#!/usr/bin/env node

/**
 * Plugin/CHANGELOG.md release sections.
 *
 *   node scripts/plugin-changelog.mjs notes <x.y.z>   print that version's section; exit 1 if missing
 *
 * release-plugin.js imports `cutRelease` to turn `## [Unreleased]` into the new version's
 * section; plugin-release.yml runs `notes` so a tag without a section fails before publishing.
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const changelogPath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'Plugin',
	'CHANGELOG.md'
);

const UNRELEASED = '## [Unreleased]';

// Body of the `## [<heading>]` section: everything up to the next `## [`.
function sectionBody(text, heading) {
	const start = text.indexOf(`## [${heading}]`);
	if (start < 0) return null;
	const bodyStart = text.indexOf('\n', start) + 1;
	const next = text.indexOf('\n## [', bodyStart);
	return text.slice(bodyStart, next < 0 ? text.length : next + 1).trim();
}

/**
 * Renames `## [Unreleased]` to `## [version] - date` and opens a fresh empty `## [Unreleased]`
 * above it. Throws when Unreleased is missing or empty: a release with nothing written up.
 */
export function cutRelease(
	version,
	date = new Date().toISOString().slice(0, 10),
	{ write = true } = {}
) {
	const text = readFileSync(changelogPath, 'utf8');
	if (text.includes(`## [${version}]`)) {
		throw new Error(`Plugin/CHANGELOG.md already has a ${version} section.`);
	}
	const body = sectionBody(text, 'Unreleased');
	if (body === null) throw new Error(`Plugin/CHANGELOG.md has no "${UNRELEASED}" section.`);
	if (!body)
		throw new Error(`Plugin/CHANGELOG.md "${UNRELEASED}" is empty: write up the release first.`);

	const updated = text.replace(UNRELEASED, `${UNRELEASED}\n\n## [${version}] - ${date}`);
	if (write) writeFileSync(changelogPath, updated);
	return changelogPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, version] = process.argv.slice(2);
	if (command !== 'notes' || !version) {
		console.error('Usage: node scripts/plugin-changelog.mjs notes <x.y.z>');
		process.exit(2);
	}
	const body = sectionBody(readFileSync(changelogPath, 'utf8'), version);
	if (!body) {
		console.error(
			`Plugin/CHANGELOG.md has no "## [${version}]" section. Release with \`pnpm release:plugin\`, which cuts it.`
		);
		process.exit(1);
	}
	console.log(body);
}
