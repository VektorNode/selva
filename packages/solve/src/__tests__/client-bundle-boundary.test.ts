import { describe, expect, it, beforeAll } from 'vitest';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Plan Phase 4, guard 3 — the client/server boundary, checked on the SHIPPED ARTIFACT.
 *
 * The other two guards work on source: `tsup.config.ts` exports no root barrel (so a consumer can't
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
 * a fresh clone running `pnpm test` before `pnpm build` shouldn't see a red herring. CI builds
 * before testing, and `pnpm build` runs `type-check` first, so the artifact is real when it counts.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const clientEntry = path.join(packageRoot, 'dist/client.js');
const hasBuild = existsSync(clientEntry);

/** Bundle an entry for the browser and return the emitted JS. */
async function bundleForBrowser(entry: string): Promise<string> {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'esm',
		// Externalize nothing: the point is to see everything the entry actually pulls in.
		// A `node:*` import would fail resolution here rather than being silently marked external.
		logLevel: 'silent'
	});
	return result.outputFiles.map((f) => f.text).join('\n');
}

describe.skipIf(!hasBuild)('client bundle boundary (plan Phase 4, guard 3)', () => {
	let bundled: string;

	beforeAll(async () => {
		bundled = await bundleForBrowser(clientEntry);
	}, 60_000);

	it('bundles for the browser at all — no node builtin reaches the client entry', () => {
		// esbuild with platform:'browser' fails to resolve `node:zlib`/`node:crypto`, so reaching
		// this line already proves the absence. Asserted explicitly so the reason is visible when
		// a future change makes the build throw instead.
		//
		// Verified by probe (2026-07-30): adding `export { runSolvePipeline } from
		// '../server/solve-pipeline.js'` to `client/index.ts` fails HERE, in beforeAll, on
		// `node:zlib` — before any string assertion below runs. That is the guard's real teeth;
		// the greps catch the subtler case of server code with no node import.
		expect(bundled.length).toBeGreaterThan(0);
	});

	it('carries no server-only module', () => {
		// Names that exist only in `server/`. If one appears, `client/` (or something `shared/`
		// pulls in) reached across the boundary.
		const serverOnly = [
			'runSolvePipeline',
			'createClientCache',
			'createDefinitionByteCache',
			'createMemorySolveResultCache',
			'createSolveCacheSingleFlight',
			'deriveSolveCacheInputKey',
			'encodeSolveCacheEntry',
			'transformInputParameter'
		];
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
		// A negative control. Without it, a bundler change that silently emitted an empty string
		// would leave every assertion above passing and testing nothing.
		//
		// Bundled for node, since that is what the server entry legitimately targets — the browser
		// build would fail on `node:zlib` (itself the boundary working, just not observable as a
		// string match).
		const serverBundle = await build({
			entryPoints: [path.join(packageRoot, 'dist/server.js')],
			bundle: true,
			write: false,
			platform: 'node',
			format: 'esm',
			external: ['@selvajs/*'],
			logLevel: 'silent'
		}).then((r) => r.outputFiles.map((f) => f.text).join('\n'));

		expect(serverBundle).toContain('runSolvePipeline');
	}, 60_000);
});

describe.skipIf(hasBuild)('client bundle boundary', () => {
	it.skip('needs `pnpm build` — dist/client.js is missing', () => {});
});
