import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { buildDynamicValueListOptions } from '../dynamic-value-list';

// The collector keys `values` by the ContextBake GUID. A dynamicValueList output can live in
// schema.outputs[] OR only in the layout (a routing sink). These pin that BOTH are honoured —
// the layout-only case is the bug where the C# collector sent the payload but the UI threw it away.

const BAKE = 'bake-guid';
const TARGET = 'target-input-guid';

function schemaWith(opts: { outputs?: UISchema['outputs']; layoutItems?: unknown[] }): UISchema {
	return {
		outputs: opts.outputs ?? [],
		layout: {
			type: 'tabbed',
			tabs: [
				{ id: 't1', groups: [{ id: 'g1', label: 'g1', order: 0, items: opts.layoutItems ?? [] }] }
			]
		}
	} as unknown as UISchema;
}

const layoutItem = (paramId: string, targetInputId: string) =>
	({
		id: 'li1',
		type: 'output',
		widgetType: 'dynamicValueList',
		paramId,
		config: { targetInputId }
	}) as unknown;

const payload = (targetInputId: string | null, options: Record<string, string>) => ({
	targetInputId,
	options
});

describe('buildDynamicValueListOptions', () => {
	it('routes options from a schema.outputs[] source', () => {
		const schema = schemaWith({
			outputs: [{ id: BAKE, type: 'dynamicValueList', targetInputId: TARGET }] as never
		});

		const result = buildDynamicValueListOptions(schema, {
			[BAKE]: payload(TARGET, { A: '1', B: '2' })
		});

		expect(result[TARGET]).toEqual({ A: '1', B: '2' });
	});

	it('routes options from a LAYOUT-only source (the dropped-data bug)', () => {
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, TARGET)] });

		const result = buildDynamicValueListOptions(schema, {
			[BAKE]: payload(TARGET, { Sphere: '0', Box: '1' })
		});

		expect(result[TARGET]).toEqual({ Sphere: '0', Box: '1' });
	});

	it("prefers the payload's targetInputId over the schema fallback", () => {
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, 'stale-target')] });

		const result = buildDynamicValueListOptions(schema, {
			[BAKE]: payload('live-target', { A: '1' })
		});

		expect(result['live-target']).toEqual({ A: '1' });
		expect(result['stale-target']).toBeUndefined();
	});

	it('falls back to the schema targetInputId when the payload omits it', () => {
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, TARGET)] });

		const result = buildDynamicValueListOptions(schema, {
			[BAKE]: payload(null, { A: '1' })
		});

		expect(result[TARGET]).toEqual({ A: '1' });
	});

	it('parses a JSON-string payload (Rhino.Compute path)', () => {
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, TARGET)] });

		const result = buildDynamicValueListOptions(schema, {
			[BAKE]: JSON.stringify(payload(TARGET, { A: '1' }))
		});

		expect(result[TARGET]).toEqual({ A: '1' });
	});

	it('returns the SAME parsed object for repeated large string payloads (memoization)', () => {
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, TARGET)] });
		// Above the 1024-char memoization threshold — the expensive compute-mode path.
		const bigOptions: Record<string, string> = {};
		for (let i = 0; i < 100; i++) bigOptions[`option-${i}-${'x'.repeat(20)}`] = String(i);
		const str = JSON.stringify(payload(TARGET, bigOptions));

		const first = buildDynamicValueListOptions(schema, { [BAKE]: str });
		// A later solve delivering an identical (even newly-allocated) string must yield
		// the same object reference — referential stability is what stops the dropdown
		// subtree from re-rendering on every unrelated values change.
		const second = buildDynamicValueListOptions(schema, { [BAKE]: String(str) });

		expect(first[TARGET]).toEqual(bigOptions);
		expect(second[TARGET]).toBe(first[TARGET]);
	});

	it('dedupes outputs[] over layout for the same id', () => {
		const schema = schemaWith({
			outputs: [{ id: BAKE, type: 'dynamicValueList', targetInputId: 'from-outputs' }] as never,
			layoutItems: [layoutItem(BAKE, 'from-layout')]
		});

		// Payload omits targetInputId -> the outputs[] fallback wins (it's set last in the dedupe map).
		const result = buildDynamicValueListOptions(schema, {
			[BAKE]: payload(null, { A: '1' })
		});

		expect(result['from-outputs']).toEqual({ A: '1' });
		expect(result['from-layout']).toBeUndefined();
	});

	it('ignores values with no matching source', () => {
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, TARGET)] });

		const result = buildDynamicValueListOptions(schema, {
			'unrelated-id': payload(TARGET, { A: '1' })
		});

		expect(Object.keys(result)).toHaveLength(0);
	});

	// The SAME json file the C# DynamicValueListPayload test loads. If C# and TS stop agreeing on
	// this shape, one side's CI goes red — that's the cross-stack drift guard.
	it('routes the shared cross-stack golden fixture', () => {
		const fixturePath = fileURLToPath(
			new URL('../../../../../schemas/fixtures/dynamic-value-list-payload.json', import.meta.url)
		);
		const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));
		const schema = schemaWith({ layoutItems: [layoutItem(BAKE, fixture.targetInputId)] });

		const result = buildDynamicValueListOptions(schema, { [BAKE]: fixture });

		expect(result[fixture.targetInputId]).toEqual(fixture.options);
		expect(result[fixture.targetInputId]).toEqual({ Sphere: '0', Box: '1', Cone: '2' });
	});
});
