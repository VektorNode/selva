// What more than one script in this folder needs to know about the plug-in.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

export const logoPath = join(projectRoot, 'packages/plugin-ui/static/favicon/favicon.svg');

/** The plug-in's version, from the one place that holds it: `<Version>` in Selva.GH.csproj. */
export function readPluginVersion() {
	const csprojPath = join(projectRoot, 'Plugin/Selva.GH/Selva.GH.csproj');
	const version = readFileSync(csprojPath, 'utf-8')
		.match(/<Version>([^<]+)<\/Version>/)?.[1]
		.trim();
	if (!version) throw new Error(`No <Version> in ${csprojPath}`);
	return version;
}

let logo;

/**
 * Selva's logo as a sharp pipeline, `size` px square. Each size is drawn from the SVG, not
 * scaled from another one.
 */
export async function renderLogo(size) {
	logo ??= (async () => {
		// sharp is a dependency of the Selva app, not of the repo root.
		const sharp = createRequire(join(projectRoot, 'packages/selva/package.json'))('sharp');
		const svg = readFileSync(logoPath);
		const { width } = await sharp(svg).metadata();
		return { sharp, svg, width };
	})();
	const { sharp, svg, width } = await logo;
	// sharp rasterises an SVG at 72 dpi: this density makes its own width come out as `size`.
	return sharp(svg, { density: (72 * size) / width }).resize(size, size);
}
