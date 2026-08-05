// Cross-stack wire-contract fixtures. These load the SAME json files the C# side asserts against
// in OutboundEnvelopesTests, closing the drift loop for the two message shapes that historically
// broke the UI silently (ADR 0002):
//   - parametersAdded: availableParams must be TOP-LEVEL, never wrapped under `data`.
//   - metadataUpdated: changedParams must be a FLAT array, not a nested {inputs,outputs} object.
// If the C# serializer changes shape without updating the fixture, the C# test reddens; if a
// fixture change breaks the TS guard, this test reddens. Either way drift fails a test, not a canvas.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateInboundMessage } from './messageSchemas';

function loadFixture(name: string): Record<string, unknown> {
	const path = new URL(`../../../../schemas/fixtures/wire/${name}`, import.meta.url);
	return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('wire fixtures (cross-stack with C# OutboundEnvelopesTests)', () => {
	it('parametersAdded: guard accepts it and availableParams is top-level', () => {
		const fixture = loadFixture('parameters-added.json');

		const result = validateInboundMessage(fixture);
		expect(result.ok).toBe(true);

		// The bug this pins: availableParams at the top level, NOT under `data`.
		expect(fixture.availableParams).toBeDefined();
		expect(fixture.data).toBeUndefined();
	});

	it('metadataUpdated: guard accepts it and changedParams is a flat array', () => {
		const fixture = loadFixture('metadata-updated.json');

		const result = validateInboundMessage(fixture);
		expect(result.ok).toBe(true);

		// The bug this pins: a flat array keyed by id, not a nested {inputs,outputs} object.
		expect(Array.isArray(fixture.changedParams)).toBe(true);
		const flat = fixture.changedParams as Array<Record<string, unknown>>;
		expect(flat.length).toBe(2);
		for (const entry of flat) {
			expect(typeof entry.id).toBe('string');
			expect(typeof entry.nickname).toBe('string');
		}
	});
});
