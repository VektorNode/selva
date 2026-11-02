import { describe, expect, it, beforeAll } from 'vitest';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Checks the client/server boundary on the SHIPPED ARTIFACT.
 *
 * Two other guards work on source: `tsdown.config.ts` exports no root barrel (so a consumer can't
 * reach `server/` through one innocent import), and eslint `no-restricted-imports` stops `client/`
 * from importing `server/`, `@selvajs/platform`, `@selvajs/server` or `node:*`. Both are worth
 * having, and neither can see through a bundler.
 *
 * This one bundles `dist/client.js` the way a browser app would and asserts that nothing
 * server-only made it in. The failure it exists to catch is real and quiet: `client/` gains a
 * type-only import that a refactor turns into a value import, or a `shared/` module — which BOTH
 * halves import — grows a `node:crypto` call. Nothing errors; a browser bundle just quietly starts
 * carrying `process.env` reads and, in the worst case, storage credentials.
 *
 * Runs against `dist/`, so it needs a build. Skips (loudly) rather than fails when there isn't one —
 * a fresh clone running `pnpm test` before `pnpm build` shouldn't see a red herring. `turbo.json`
 * makes this package's `test` depend on its `build`, so the artifact is real when it counts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const clientEntry = path.join(packageRoot, 'dist/client.js');
const serverEntry = path.join(packageRoot, 'dist/server.js');
const hasBuild = existsSync(clientEntry) && existsSync(serverEntry);

/** Names that exist only in `server/`. */
const serverOnly = [
	'runSolvePipeline',
	'createClientCache',
	'createDefinitionByteCache',
	'createSolveCacheSingleFlight',
	'buildSolveInputTree'
];

/** Bundle an entry for the browser and return the emitted JS. */
async function bundleForBrowser(entry: string): Promise<string> {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'esm',
		// Externalize nothing — a `node:*` import must fail resolution here, not get marked external.
		logLevel: 'silent'
	});
	return result.outputFiles.map((f) => f.text).join('\n');
}

describe.skipIf(!hasBuild)('client bundle boundary', () => {
	let bundled: string;

	beforeAll(async () => {
		bundled = await bundleForBrowser(clientEntry);
	}, 60_000);

	// esbuild with platform:'browser' fails to resolve `node:zlib`, so a node builtin reaching the
	// client entry fails `beforeAll`. The greps below catch the subtler case: server code with no
	// node import.
	it('carries no server-only module', () => {
		expect(serverOnly.filter((name) => bundled.includes(name))).toEqual([]);
	});

	it('reads no environment variable', () => {
		// `process.env` in a browser bundle is either a crash or a build-time inlined secret.
		expect(bundled).not.toMatch(/process\s*\.\s*env/);
	});

	it('pulls in neither the platform providers nor the server package', () => {
		expect(bundled).not.toMatch(/@selvajs\/platform/);
		expect(bundled).not.toMatch(/@selvajs\/server/);
	});

	it('proves the assertions can fail — the server entry trips them', async () => {
		// Negative control: without this, a bundler change that silently emitted an empty string
		// would leave every assertion above passing and testing nothing.
		//
		// Bundled for node — the server entry legitimately targets node, and a browser build
		// would just fail on `node:zlib` instead of producing a comparable string.
		const serverBundle = await build({
			entryPoints: [serverEntry],
			bundle: true,
			write: false,
			platform: 'node',
			format: 'esm',
			external: ['@selvajs/*'],
			logLevel: 'silent'
		}).then((r) => r.outputFiles.map((f) => f.text).join('\n'));

		expect(serverOnly.filter((name) => !serverBundle.includes(name))).toEqual([]);
	}, 60_000);
});
