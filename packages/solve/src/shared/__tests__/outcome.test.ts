import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeOutcome, finalizeResult, outcomeFromComputeMessages } from '../outcome.js';

// Written by the C# SolveOutcomeContractTests; see fixtures/solve/README.md.
const fixture = (name: string) =>
	JSON.parse(
		readFileSync(new URL(`../../../../schemas/fixtures/solve/${name}`, import.meta.url), 'utf8')
	);

const outcome = fixture('outcome.json');
const selvaResponse = fixture('compute-response-selva.json');
const legacyResponse = fixture('compute-response-legacy.json');

describe('cross-stack verdict', () => {
	it('decodes the plugin outcome with source and isGate omitted when empty', () => {
		const decoded = decodeOutcome(outcome);
		expect(decoded).toEqual({
			diagnostics: [
				{ level: 'error', message: 'More than 200 spheres', source: 'Message', isGate: true },
				{ level: 'warning', message: 'Radius overlaps', source: 'Message' },
				{ level: 'warning', message: 'Input parameter G failed to collect data', source: 'Area' },
				{ level: 'remark', message: 'Voronoi takes a while', source: 'Message', isGate: true }
			],
			blocked: true,
			aborted: false
		});
	});

	it("reads the fork's selva block as the same verdict", () => {
		expect(decodeOutcome(selvaResponse.selva.outcome)).toEqual(decodeOutcome(outcome));
	});

	it('recovers the same verdict from markers, minus what they cannot carry', () => {
		const structured = decodeOutcome(outcome)!;
		const legacy = outcomeFromComputeMessages(legacyResponse.errors, legacyResponse.warnings);
		expect(legacy).toEqual({
			...structured,
			diagnostics: structured.diagnostics.filter((d) => d.level !== 'remark')
		});
	});
});

describe('decodeOutcome', () => {
	it('is null for anything that is not an outcome', () => {
		expect(decodeOutcome(undefined)).toBeNull();
		expect(decodeOutcome({ blocked: true })).toBeNull();
	});

	it('narrows unknown levels, drops empty and repeated messages, and blocks an abort', () => {
		expect(
			decodeOutcome({
				diagnostics: [
					{ level: 'fatal', message: ' x ', source: null, isGate: false },
					{ level: 'remark', message: 'x' },
					{ level: 'error', message: '   ' }
				],
				blocked: false,
				aborted: true
			})
		).toEqual({ diagnostics: [{ level: 'remark', message: 'x' }], blocked: true, aborted: true });
	});
});

describe('finalizeResult', () => {
	const clean = { diagnostics: [], blocked: false, aborted: false };

	it('keeps outputs and meshes for a clean outcome, and leaves absent meshes absent', () => {
		expect(finalizeResult({ outputs: { a: 1 }, meshes: ['m'] }, clean)).toMatchObject({
			outputs: { a: 1 },
			meshes: ['m'],
			blocked: false
		});
		expect(finalizeResult({ outputs: {} }, clean)).not.toHaveProperty('meshes');
	});

	it('drops outputs and clears meshes for a rejected outcome', () => {
		const result = finalizeResult(
			{ outputs: { a: 1 }, meshes: ['m'], source: 'raw' },
			decodeOutcome(outcome)!
		);
		expect(result.outputs).toEqual({});
		expect(result.meshes).toEqual([]);
		expect(result.source).toBe('raw');
		expect(result.errors).toEqual(['More than 200 spheres']);
		expect(result.warnings).toHaveLength(2);
	});
});
