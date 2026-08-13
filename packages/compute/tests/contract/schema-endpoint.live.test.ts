/**
 * LIVE check that a running compute server's `/grasshopper/schema` body is
 * readable by this client.
 *
 * ## Why a live test, when `server-contract.live.test.ts` already watches drift
 *
 * That test parses the server's C# SOURCE. The failure this one guards against
 * is invisible there, because it is not in the source at all — it is an assembly
 * identity problem that only exists at runtime:
 *
 * `Selva.gha` ILRepack-merges Newtonsoft.Json, so the `[JsonProperty("inputs")]`
 * attributes on `UISchema` have type `Selva!Newtonsoft.Json.JsonPropertyAttribute`.
 * When compute serializes that POCO with its OWN Newtonsoft, the attributes are a
 * foreign type, so they are ignored and every key falls back to its raw CLR name:
 * `Inputs`, `Layout`, `SchemaVersion`. The C# reads correctly either way; only a
 * real request against a real server reveals which serializer won.
 *
 * Opt-in, following `server-contract.live.test.ts`: needs a compute server, so it
 * self-skips unless RUN_LIVE_SCHEMA=1. Point it at one with COMPUTE_URL
 * (default http://localhost:6001); COMPUTE_API_KEY if the server requires one.
 *
 *   RUN_LIVE_SCHEMA=1 COMPUTE_URL=http://localhost:6001 pnpm test schema-endpoint.live
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { normalizeUISchemaCasing } from '../../src/grasshopper/io/normalize-ui-schema';
import { readSchemaResults } from '../../src/grasshopper/io/schema-endpoint';

const RUN_LIVE = process.env.RUN_LIVE_SCHEMA === '1';
const COMPUTE_URL = process.env.COMPUTE_URL || 'http://localhost:6001';
const API_KEY = process.env.COMPUTE_API_KEY;

// A definition carrying a real embedded Selva schema.
const FIXTURE = resolve(__dirname, '../../../selva/e2e/fixtures/bench-display.gh');

// `tests/setup.ts` replaces global.fetch with a vi.fn() for unit suites and
// stashes the real one here for exactly this case.
const nativeFetch = (globalThis as { __nativeFetch?: typeof fetch }).__nativeFetch ?? fetch;

async function postSchema(): Promise<unknown> {
	const form = new FormData();
	form.append(
		'file',
		new Blob([new Uint8Array(readFileSync(FIXTURE))], { type: 'application/octet-stream' }),
		'definition.gh'
	);

	const response = await nativeFetch(new URL('/grasshopper/schema', COMPUTE_URL), {
		method: 'POST',
		headers: API_KEY ? { RhinoComputeKey: API_KEY } : {},
		body: form,
		signal: AbortSignal.timeout(30_000)
	});

	expect(response.ok, `${COMPUTE_URL} returned ${response.status}`).toBe(true);
	return response.json();
}

describe.runIf(RUN_LIVE)('live /grasshopper/schema body', () => {
	it('yields a schema this client can read', async () => {
		const results = readSchemaResults(await postSchema());
		const raw = results.flatMap((r) => r.schemas ?? []);

		// A definition may carry several Context Bake components, so several schemas.
		expect(
			raw.length,
			`no schemas returned: ${JSON.stringify(results).slice(0, 300)}`
		).toBeGreaterThan(0);

		// The assertion that matters. Whichever casing the server emitted, the
		// normalized schema must expose the keys every consumer reads. Before the
		// normalizer, this is exactly where a PascalCase body failed.
		for (const [index, entry] of raw.entries()) {
			const schema = normalizeUISchemaCasing(entry) as Record<string, unknown>;

			expect(
				Array.isArray(schema.inputs),
				`schema[${index}] has no inputs array; keys: ${Object.keys(schema)}`
			).toBe(true);
			expect(typeof schema.schemaVersion, `schema[${index}].schemaVersion`).toBe('string');
			expect(schema.layout, `schema[${index}].layout`).toBeTypeOf('object');
		}
	}, 40_000);

	// Records which serializer the server used. Not a failure either way — the
	// normalizer handles both — but it names the deployment's real state, which is
	// what makes a PascalCase server diagnosable instead of merely survivable.
	it('reports the raw wire casing', async () => {
		const raw = readSchemaResults(await postSchema()).flatMap((r) => r.schemas ?? []);
		const keys = raw.flatMap((entry) => Object.keys(entry as object));
		const pascal = keys.filter((k) => k[0] >= 'A' && k[0] <= 'Z');

		console.info(
			pascal.length > 0
				? `[live] ${COMPUTE_URL} emits PascalCase (${pascal.slice(0, 5).join(', ')}) — ` +
						`compute serialized with its own Newtonsoft, not Selva.gha's merged copy. ` +
						`The client normalizes it, but the server is misconfigured.`
				: `[live] ${COMPUTE_URL} emits camelCase — attributes honored.`
		);

		expect(keys.length).toBeGreaterThan(0);
	}, 40_000);
});

// Always-present marker so the file isn't reported as empty when skipped.
describe('live schema endpoint test wiring', () => {
	it('is opt-in via RUN_LIVE_SCHEMA=1', () => {
		expect(typeof RUN_LIVE).toBe('boolean');
	});
});
