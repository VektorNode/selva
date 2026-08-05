// Cross-stack wire contract. The fixtures in packages/schemas/fixtures/wire/ are generated and
// golden-tested by the C# side (WireFixtureContractTests serializes every OutboundEnvelopes
// factory and compares byte-for-byte; a reflection test forbids a factory without a fixture).
// This suite closes the loop from the TS side: every fixture must pass the Zod guard the
// dispatcher runs on live messages, and every validated message type must have a fixture.
// A shape change on either side reddens a test, not a live canvas.
//
// Regenerating after an intentional C# shape change:
//   UPDATE_WIRE_FIXTURES=1 dotnet test --filter WireFixtureContractTests

import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateInboundMessage, validatedMessageTypes } from '../messageSchemas';

const fixturesDir = new URL('../../../../../schemas/fixtures/wire/', import.meta.url);

// Documented in messageSchemas.ts as subscribed but never broadcast by the
// plugin; there is no C# factory to generate a fixture from.
const typesWithoutBroadcaster = ['outputUpdate'];

const kebab = (type: string) => type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

function loadFixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(new URL(name, fixturesDir), 'utf-8'));
}

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

describe('wire fixtures (cross-stack with C# WireFixtureContractTests)', () => {
	it('every validated message type has a fixture', () => {
		const expected = validatedMessageTypes
			.filter((t) => !typesWithoutBroadcaster.includes(t))
			.map((t) => `${kebab(t)}.json`)
			.sort();
		expect([...fixtureFiles].sort()).toEqual(expected);
	});

	it.each(fixtureFiles)('%s passes the inbound message guard', (file) => {
		const fixture = loadFixture(file);

		// A fixture for an unvalidated type would "pass" vacuously — require a real schema.
		expect(validatedMessageTypes).toContain(fixture.type);

		const result = validateInboundMessage(fixture);
		if (!result.ok) {
			expect.fail(`${file} rejected by the Zod guard:\n${result.error.message}`);
		}
	});

	// The two shape rules that historically broke the UI silently (ADR 0002) stay
	// pinned explicitly, so a "fix" that regenerates fixtures into the broken
	// shape still fails loudly here.

	it('parametersAdded: availableParams is top-level, never wrapped under data', () => {
		const fixture = loadFixture('parameters-added.json');
		expect(fixture.availableParams).toBeDefined();
		expect(fixture.data).toBeUndefined();
	});

	it('metadataUpdated: changedParams is a flat array keyed by id', () => {
		const fixture = loadFixture('metadata-updated.json');
		expect(Array.isArray(fixture.changedParams)).toBe(true);
		for (const entry of fixture.changedParams as Array<Record<string, unknown>>) {
			expect(typeof entry.id).toBe('string');
			expect(typeof entry.nickname).toBe('string');
		}
	});
});
