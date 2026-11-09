// Run: node --test scripts/develop/solve-bench/lib.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	createDedupeTracker,
	inputSummary,
	joinRouting,
	median,
	outputSummary,
	parseRecomputed,
	parseRoutingLine,
	parseServerTiming,
	pickValue,
	sessionId,
	sessionLogId,
	userBase
} from './lib.mjs';

const tree = (name, branches) => ({
	ParamName: name,
	InnerTree: Object.fromEntries(
		Object.entries(branches).map(([path, items]) => [
			path,
			items.map((data) => ({ type: 'System.String', data }))
		])
	)
});

// sessionId.test.ts in packages/selva pins the same vector for computeSessionId, so a change on
// either side fails one of the two.
test('sessionId matches the vector Selva pins for computeSessionId', () => {
	assert.equal(
		sessionId('test-secret-that-is-at-least-32-chars-long', 'user-1', 'def-1'),
		'63731a4c6bfb9b752e106f6385e6c3b5'
	);
});

test('sessionLogId is the 8-character uppercase hash compute logs', () => {
	const id = 'a1b2';
	assert.equal(
		sessionLogId(id),
		createHash('sha256').update(id).digest('hex').slice(0, 8).toUpperCase()
	);
});

test('parseServerTiming reads durations, descriptions and bare names', () => {
	assert.deepEqual(
		parseServerTiming('solve;dur=488, recomputed;desc="9/781", cache, gh;dur=415.5'),
		{
			solve: 488,
			recomputed: '9/781',
			cache: true,
			gh: 415.5
		}
	);
	assert.deepEqual(parseServerTiming(null), {});
	assert.deepEqual(parseRecomputed('9/781'), { ran: 9, total: 781 });
	assert.equal(parseRecomputed(undefined), null);
});

test('inputSummary unwraps single items and keeps several as a list', () => {
	const summary = inputSummary([
		tree('Span', { '{0}': ['21.3'] }),
		tree('Tags', { '{0}': ['"a"', '"b"'] }),
		tree('None', {})
	]);
	assert.deepEqual(summary, { Span: 21.3, Tags: ['a', 'b'], None: null });
});

test('outputSummary counts bytes per output and per branch', () => {
	const s = outputSummary([tree('Mesh', { '{0}': ['abcd'], '{1}': ['ef'] }), tree('Empty', {})]);
	assert.equal(s.Mesh.bytes, 6);
	assert.equal(s.Mesh.items, 2);
	assert.deepEqual(s.Mesh.branches['{1}'], { items: 1, bytes: 2 });
	assert.equal(s.Empty.items, 0);
});

test('the dedupe tracker counts an item as unchanged only within its session and the last two responses', () => {
	const big = (c) => c.repeat(5000);
	const d = createDedupeTracker();
	const first = d.measure('a', [tree('Mesh', { '{0}': [big('x')], '{1}': [big('y')] })]);
	assert.equal(first.unchangedBytes, 0);
	assert.equal(first.totalBytes, 10000);

	const second = d.measure('a', [tree('Mesh', { '{0}': [big('x')], '{1}': [big('z')] })]);
	assert.equal(second.unchangedBytes, 5000);
	assert.deepEqual(
		second.perOutput.Mesh.branches['{0}'].map((b) => b.unchanged),
		[true]
	);

	// Another session never matches the first one's items.
	assert.equal(d.measure('b', [tree('Mesh', { '{0}': [big('x')] })]).unchangedBytes, 0);

	// Small items are never hashed.
	assert.equal(d.measure('a', [tree('N', { '{0}': ['1'] })]).totalBytes, 1);

	// 'y' was three responses ago for session a, so it has dropped out of the window.
	d.measure('a', [tree('Mesh', { '{0}': [big('w')] })]);
	assert.equal(d.measure('a', [tree('Mesh', { '{0}': [big('y')] })]).unchangedBytes, 0);
});

test('parseRoutingLine reads compute Debug routing lines', () => {
	assert.deepEqual(
		parseRoutingLine(
			'RC   [08:06:45 DBG] Session 0E41B28F routed to compute.geometry on port 6001: hit'
		),
		{ time: '08:06:45', logId: '0E41B28F', port: 6001, outcome: 'hit' }
	);
	assert.equal(parseRoutingLine('RC   [08:06:45 INF] HTTP POST /grasshopper responded 200'), null);
});

test('joinRouting pairs routing lines with solves that reached compute, per session, in order', () => {
	const solves = [
		{ logId: 'A', reachedCompute: true },
		{ logId: 'A', reachedCompute: false },
		{ logId: 'B', reachedCompute: true },
		{ logId: 'A', reachedCompute: true },
		{ logId: null, reachedCompute: true }
	];
	joinRouting(solves, [
		{ logId: 'A', outcome: 'claimed', port: 1 },
		{ logId: 'B', outcome: 'claimed', port: 2 },
		{ logId: 'A', outcome: 'hit', port: 1 }
	]);
	assert.deepEqual(
		solves.map((s) => s.routing ?? null),
		['claimed', null, 'claimed', 'hit', null]
	);
});

test('pickValue stays in range and changes the value', () => {
	let seed = 0.1;
	const random = () => (seed = (seed * 9301 + 0.49297) % 1);
	for (let i = 0; i < 50; i++) {
		const v = pickValue({ min: 1, max: 32, integer: true }, 5, random);
		assert.ok(Number.isInteger(v) && v >= 1 && v <= 32 && v !== 5);
	}
	assert.match(pickValue({ color: true }, undefined, random), /^#[0-9a-f]{6}$/);
	assert.equal(pickValue({ boolean: true }, true, random), false);
	assert.ok(['a', 'b'].includes(pickValue({ values: ['a', 'b'] }, 'c', random)));
});

test('userBase layers a user over the profile base', () => {
	assert.deepEqual(userBase({ base: { a: 1, b: 2 }, perUser: [{}, { b: 3 }] }, 1), { a: 1, b: 3 });
	assert.deepEqual(userBase({ base: { a: 1 } }, 2), { a: 1 });
});

test('median ignores missing values', () => {
	assert.equal(median([3, null, 1, 2]), 2);
	assert.equal(median([1, 2, 3, 4]), 2.5);
	assert.equal(median([]), null);
});
