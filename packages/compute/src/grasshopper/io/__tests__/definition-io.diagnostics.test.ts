/**
 * IO load-diagnostics seam: the server reports definition-LOAD errors/warnings
 * (missing plugin, obsolete component, …) on the `/io` response. The client used
 * to drop them, so a degraded input list looked mysteriously empty. These pin
 * that `loadErrors` / `loadWarnings` now surface — and stay absent on a clean load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchDefinitionIO, fetchParsedDefinitionIO } from '../definition-io';
import { createMockResponse } from '@tests/helpers/mock-fetch';
import { setLogger } from '@/core/utils/logger';
import { resetClientSideWarnings } from '@/core/utils/warnings';

const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
const CONFIG = { serverUrl: 'http://localhost:6500' };
const DEF = 'https://example.com/d.gh';

afterEach(() => fetchMock.mockReset());

function ioResponse(over: Record<string, unknown> = {}) {
	return {
		description: '',
		filename: '',
		cachekey: 'k',
		inputnames: [],
		outputnames: [],
		icon: null,
		inputs: [{ id: 'g1', name: 'X', nickname: 'X', paramType: 'Number', treeAccess: false }],
		outputs: [{ name: 'Y', nickname: 'Y', paramType: 'Number', id: 'g2' }],
		warnings: [],
		errors: [],
		...over
	};
}

describe('fetchDefinitionIO load diagnostics', () => {
	it('surfaces server load errors and warnings', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse(
				ioResponse({
					errors: ['1. Could not load assembly Foo.gha'],
					warnings: ['Obsolete component: Bar']
				})
			)
		);

		const res = await fetchDefinitionIO(DEF, CONFIG);
		expect(res.loadErrors).toEqual(['1. Could not load assembly Foo.gha']);
		expect(res.loadWarnings).toEqual(['Obsolete component: Bar']);
	});

	it('omits the fields entirely on a clean load', async () => {
		fetchMock.mockResolvedValue(createMockResponse(ioResponse()));

		const res = await fetchDefinitionIO(DEF, CONFIG);
		expect(res).not.toHaveProperty('loadErrors');
		expect(res).not.toHaveProperty('loadWarnings');
	});

	it('drops blank/null entries but keeps non-string diagnostics by coercion', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse(ioResponse({ errors: ['real', '', '   ', null, 42] }))
		);

		const res = await fetchDefinitionIO(DEF, CONFIG);
		// Blank strings and null vanish; a non-string entry is still information
		// the server reported — it must survive as a string, not be dropped.
		expect(res.loadErrors).toEqual(['real', '42']);
	});

	it('coerces object diagnostics to their message field (issue 78)', async () => {
		// A server fork reporting errors as { message } objects used to yield an
		// empty inputs list with NO explanation — the diagnostics were all dropped.
		fetchMock.mockResolvedValue(
			createMockResponse(
				ioResponse({
					errors: [{ message: 'Could not load assembly Foo.gha' }, { code: 7 }],
					warnings: [{ Message: 'Obsolete component' }] // PascalCase message read too
				})
			)
		);

		const res = await fetchDefinitionIO(DEF, CONFIG);
		expect(res.loadErrors).toEqual(['Could not load assembly Foo.gha', '{"code":7}']);
		expect(res.loadWarnings).toEqual(['Obsolete component']);
	});
});

describe('fetchDefinitionIO guards malformed inputs/outputs', () => {
	// A server fault can return a 200 whose body omits inputs/outputs (e.g. a
	// definition-LOAD failure surfacing as malformed-success). The downstream
	// for...of must not throw "inputs is not iterable".
	it.each([
		['missing', { inputs: undefined, outputs: undefined }],
		['null', { inputs: null, outputs: null }],
		['non-array object', { inputs: {}, outputs: {} }],
		['string', { inputs: 'oops', outputs: 'oops' }]
	])('coerces %s inputs/outputs to []', async (_label, over) => {
		fetchMock.mockResolvedValue(createMockResponse(ioResponse(over)));

		const res = await fetchDefinitionIO(DEF, CONFIG);
		expect(res.inputs).toEqual([]);
		expect(res.outputs).toEqual([]);
	});

	it('does not throw when parsing a response with no inputs array', async () => {
		fetchMock.mockResolvedValue(createMockResponse(ioResponse({ inputs: undefined })));

		const res = await fetchParsedDefinitionIO(DEF, CONFIG);
		expect(res.inputs).toEqual([]);
	});
});

describe('fetchParsedDefinitionIO propagates load diagnostics', () => {
	it('carries loadErrors/loadWarnings through to the parsed result', async () => {
		fetchMock.mockResolvedValue(
			createMockResponse(ioResponse({ errors: ['missing plugin'], warnings: ['deprecated comp'] }))
		);

		const res = await fetchParsedDefinitionIO(DEF, CONFIG);
		expect(res.loadErrors).toEqual(['missing plugin']);
		expect(res.loadWarnings).toEqual(['deprecated comp']);
		// Inputs still parse normally alongside the diagnostics.
		expect(res.inputs).toHaveLength(1);
	});

	it('leaves them absent on a clean load', async () => {
		fetchMock.mockResolvedValue(createMockResponse(ioResponse()));

		const res = await fetchParsedDefinitionIO(DEF, CONFIG);
		expect(res).not.toHaveProperty('loadErrors');
		expect(res).not.toHaveProperty('loadWarnings');
	});
});

describe('fetchDefinitionIO errors', () => {
	it('keeps the definition bytes out of an invalid-response error', async () => {
		fetchMock.mockResolvedValue(createMockResponse(null));
		const definition = new Uint8Array(1024);

		const error = await fetchDefinitionIO(definition, CONFIG).catch((e) => e);

		expect(error.message).toBe('Invalid IO response structure');
		expect(Object.values(error.context)).not.toContain(definition);
	});
});

describe('fetchDefinitionIO in a browser', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		setLogger(null);
		resetClientSideWarnings();
	});

	it('warns that the API key is exposed, like the parsed variant', async () => {
		const warn = vi.fn();
		setLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });
		fetchMock.mockResolvedValue(createMockResponse(ioResponse()));
		vi.stubGlobal('window', {});
		vi.stubGlobal('process', undefined);
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)' });

		await fetchDefinitionIO(DEF, CONFIG);

		expect(warn.mock.calls.some(([message]) => String(message).includes('client side'))).toBe(true);
	});
});
