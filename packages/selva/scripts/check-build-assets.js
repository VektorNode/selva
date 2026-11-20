#!/usr/bin/env node
/**
 * Post-build: fail the build when a file the viewer fetches by URL is missing from `build/client`.
 * Nothing imports them, so a lost one breaks only at run time: the 3D view and
 * `selva_capture_preview` light flat without `baseHDR.hdr`.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const client = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'build', 'client');
const REQUIRED = ['baseHDR.hdr'];

const missing = REQUIRED.filter((f) => {
	const file = join(client, f);
	return !existsSync(file) || statSync(file).size === 0;
});
if (missing.length) {
	console.error(`build/client is missing ${missing.join(', ')}; check packages/selva/static.`);
	process.exit(1);
}
