import { describe, expect, it } from 'vitest';
import { validateInboundMessage } from './messageSchemas';

const SID = 'session-1';

function expectOk(message: unknown) {
	const result = validateInboundMessage(message);
	if (!result.ok) {
		throw new Error(
			`Expected validation to pass; got issues: ${JSON.stringify(result.error.issues)}`
		);
	}
	return result;
}

function expectFail(message: unknown) {
	const result = validateInboundMessage(message);
	if (result.ok) throw new Error('Expected validation to fail');
	return result;
}

describe('validateInboundMessage — known regressions', () => {
	// The original bug: C# sent the nested DiscoveredParameters object as
	// changedParams, the UI did `changedParams.forEach(...)`, which threw a
	// TypeError that the dispatcher swallowed. The flat-array contract is the
	// fix; this test locks it in.
	it('metadataUpdated rejects nested DiscoveredParameters shape', () => {
		const bad = {
			type: 'metadataUpdated',
			sessionId: SID,
			changedParams: {
				inputs: [{ id: 'a', nickname: 'x' }],
				outputs: []
			}
		};
		const result = expectFail(bad);
		expect(result.type).toBe('metadataUpdated');
		expect(result.error.issues.some((i) => i.path[0] === 'changedParams')).toBe(true);
	});

	it('metadataUpdated accepts the flat array contract', () => {
		expectOk({
			type: 'metadataUpdated',
			sessionId: SID,
			changedParams: [
				{ id: 'a', nickname: 'X', minimum: 0, maximum: 10 },
				{ id: 'b', nickname: 'Y', options: { '0': 'first', '1': 'second' } }
			]
		});
	});

	// The original bug: payload nested under `data:` (BroadcastMessage envelope)
	// while the handler reads `availableParams` at the top level. With
	// availableParams missing the handler took a fallback round-trip path. The
	// schema doesn't *force* the field — it's optional — but it does reject
	// payloads where availableParams was put in the wrong place (i.e. somewhere
	// under `data` *along with* a stray top-level field shape that wouldn't pass
	// the envelope check). Practically, the most useful regression check is the
	// happy path: a flat envelope passes.
	it('parametersAdded accepts the flat envelope', () => {
		expectOk({
			type: 'parametersAdded',
			sessionId: SID,
			availableParams: { inputs: [], outputs: [] }
		});
	});
});

describe('validateInboundMessage — happy paths', () => {
	it('initialData', () => {
		expectOk({
			type: 'initialData',
			sessionId: SID,
			schema: { whatever: true },
			schemaHash: 'abc',
			availableParams: { inputs: [], outputs: [] },
			currentValues: { a: 1 },
			outputs: {},
			isSolving: false
		});
	});

	it('schemaUpdated requires schema and optional removedIds', () => {
		expectOk({
			type: 'schemaUpdated',
			sessionId: SID,
			schema: {},
			schemaHash: 'h',
			removedIds: ['id1', 'id2']
		});
		expectOk({ type: 'schemaUpdated', sessionId: SID, schema: {} });
	});

	it('schemaSaveRejected carries the fresh canonical', () => {
		expectOk({
			type: 'schemaSaveRejected',
			sessionId: SID,
			schema: {},
			schemaHash: 'h',
			reason: 'stale'
		});
	});

	it('schemaSaved success ack', () => {
		expectOk({ type: 'schemaSaved', sessionId: SID, success: true });
		expectOk({ type: 'schemaSaved', sessionId: SID, success: false, message: 'nope' });
		// Newtonsoft serializes the C# `string message = null` default param as an
		// explicit JSON null. The schema must accept it; rejecting on null was a
		// false-positive that fired on every successful save.
		expectOk({ type: 'schemaSaved', sessionId: SID, success: true, message: null });
	});

	it('outputs with binary frame metadata', () => {
		expectOk({
			type: 'outputs',
			sessionId: SID,
			outputs: { a: 1 },
			fileOutputs: {},
			binaryBatchCount: 2,
			modelUnits: 'Meters'
		});
	});

	it('currentValues requires the values map', () => {
		expectOk({ type: 'currentValues', sessionId: SID, values: { a: 1 } });
		expectFail({ type: 'currentValues', sessionId: SID });
	});

	it('syncPreview validates the SyncChange PascalCase shape', () => {
		expectOk({
			type: 'syncPreview',
			sessionId: SID,
			fromGH: [
				{
					ParamId: 'p',
					ParamNickname: 'n',
					Field: 'nickname',
					SchemaValue: 'old',
					GHValue: 'new',
					Direction: 'fromGH'
				}
			],
			toGH: []
		});
	});

	it('syncApplied result', () => {
		expectOk({ type: 'syncApplied', sessionId: SID, success: true });
	});

	it('solvingState requires isSolving boolean', () => {
		expectOk({ type: 'solvingState', sessionId: SID, isSolving: true });
		expectFail({ type: 'solvingState', sessionId: SID });
	});

	it('runtimeMessage requires level + message', () => {
		expectOk({
			type: 'runtimeMessage',
			sessionId: SID,
			level: 'error',
			message: 'oops'
		});
		expectFail({ type: 'runtimeMessage', sessionId: SID, level: 'error' });
	});
});

describe('validateInboundMessage — envelope handling', () => {
	it('rejects non-object payloads', () => {
		const result = expectFail(null);
		expect(result.type).toBe('<missing>');
	});

	it('rejects messages missing the type field', () => {
		const result = expectFail({ sessionId: SID });
		expect(result.type).toBe('<missing>');
	});

	it('rejects messages whose type is not a string', () => {
		const result = expectFail({ type: 42, sessionId: SID });
		expect(result.type).toBe('<non-string>');
	});

	it('passes unknown message types through without validating', () => {
		// Forward-compatibility: a future C# broadcaster that adds a new type
		// shouldn't trip the validator on existing builds.
		const result = expectOk({ type: 'someBrandNewType', sessionId: SID, payload: 123 });
		expect(result.ok).toBe(true);
	});

	it('requires sessionId on validated types', () => {
		expectFail({ type: 'schemaUpdated', schema: {} });
	});
});
