/**
 * A stored definition's inputs come from its version's schema. The request body names values and
 * nothing else: an id, a nickname or a bound it supplies must not reach the solve, or a caller
 * could drop a limit or fill a slot the host reserved.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const solve = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/compute/engine.server', async (importOriginal) => ({
	...(await importOriginal<object>()),
	engine: {
		solve,
		definitionRef: (key: string) => ({
			key,
			load: async () => new Uint8Array(),
			outcome: { loaded: false, fromCache: false }
		}),
		toWebResponse: () => new Response('{}')
	}
}));
vi.mock('@selvajs/server/compute', async (importOriginal) => ({
	...(await importOriginal<object>()),
	resolveServerForOrg: async () => ({ id: 'server', serverUrl: 'http://compute.test' })
}));

import type { UISchema } from '@selvajs/schemas';
import {
	actAs,
	call,
	freshProviders,
	seedAcme,
	seedDefinition,
	type TestProviders
} from '$lib/server/__tests__/fixtures.js';
import { resetComputeRateLimit } from '$lib/server/computeRateLimit.server.js';
import { POST } from '../+server.js';

const schema = {
	name: 'Wall',
	inputs: [{ id: 'width', nickname: 'Width', paramType: 'Number', default: 10 }],
	outputs: [],
	layout: {
		type: 'flat',
		groups: [
			{
				items: [
					{
						type: 'input',
						widgetType: 'number',
						paramId: 'width',
						config: { minimum: 0, maximum: 100 }
					}
				]
			}
		]
	}
} as unknown as UISchema;

let tp: TestProviders | null = null;

beforeEach(() => {
	resetComputeRateLimit();
	solve.mockReset().mockResolvedValue({ kind: 'too_large' });
});

afterEach(async () => {
	resetComputeRateLimit();
	await tp?.cleanup();
	tp = null;
});

async function solveWith(body: Record<string, unknown>) {
	tp = await freshProviders();
	const { alice, alicesPrivate } = await seedAcme(tp);
	const def = await seedDefinition(tp, { projectId: alicesPrivate.id, ownerId: alice.id });
	const locals = await actAs(tp, alice.id);
	await tp.config.data.definitions.setVersionSchema(locals.ctx, def.version.id, schema);

	const res = await call(POST, { locals, params: { guid: def.record.guid }, body });
	return { res, sent: solve.mock.calls[0]?.[0] };
}

describe('POST /api/v1/definitions/{guid}/solve — inputs', () => {
	it('ignores the inputs of a request that forges a reserved slot', async () => {
		const { sent } = await solveWith({
			inputs: [{ id: 'evil', nickname: 'host-context', paramType: 'Text' }],
			values: { evil: 'FORGED', width: 5 }
		});

		expect(sent.inputs.map((input: { nickname: string }) => input.nickname)).toEqual(['Width']);
	});

	it('takes the bounds from the stored widget, whatever the request drops', async () => {
		const { sent } = await solveWith({
			inputs: [{ id: 'width', nickname: 'Width', paramType: 'Number' }],
			values: { width: 1e9 }
		});

		expect(sent.inputs[0]).toMatchObject({ minimum: 0, maximum: 100 });
	});

	it('solves the stored inputs when the request names none', async () => {
		const { sent } = await solveWith({ values: {} });

		expect(sent.inputs[0]).toMatchObject({ id: 'width', default: 10 });
	});
});
