// Node engine detection in `selva doctor` (issue #176).
//
// The CLI carries its own range check rather than importing @selvajs/server:
// it scaffolds the deployment that installs the runtime, so it cannot depend on
// it. These pin the two behaviours that matter — the incident direction is
// caught, and an unparseable range never produces a false failure that would
// tell an operator to upgrade a Node that is already fine.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfiesNodeRange } from '../node-range.js';

test('catches the reported incident — Node 20 host, runtime requiring >=22', () => {
	assert.equal(satisfiesNodeRange('20.20.2', '>=22.0.0'), false);
});

test('accepts a host that satisfies the floor', () => {
	assert.equal(satisfiesNodeRange('22.0.0', '>=22.0.0'), true);
	assert.equal(satisfiesNodeRange('24.16.0', '>=22.0.0'), true);
});

test('accepts a v-prefixed version, as process.version reports it', () => {
	assert.equal(satisfiesNodeRange('v22.4.0', '>=22.0.0'), true);
});

test('is exact at the boundary', () => {
	assert.equal(satisfiesNodeRange('21.9.9', '>=22.0.0'), false);
	assert.equal(satisfiesNodeRange('22.0.0', '>22.0.0'), false);
});

test('handles caret, tilde, alternatives and conjunctions', () => {
	assert.equal(satisfiesNodeRange('22.5.0', '^22.0.0'), true);
	assert.equal(satisfiesNodeRange('23.0.0', '^22.0.0'), false);
	assert.equal(satisfiesNodeRange('22.1.5', '~22.1.0'), true);
	assert.equal(satisfiesNodeRange('20.0.0', '^18.0.0 || ^20.0.0'), true);
	assert.equal(satisfiesNodeRange('19.0.0', '^18.0.0 || ^20.0.0'), false);
	assert.equal(satisfiesNodeRange('20.0.0', '>=18 <21'), true);
	assert.equal(satisfiesNodeRange('21.0.0', '>=18 <21'), false);
});

test('treats a bare major or x-range as the whole line', () => {
	assert.equal(satisfiesNodeRange('22.7.1', '22'), true);
	assert.equal(satisfiesNodeRange('22.7.1', '22.x'), true);
	assert.equal(satisfiesNodeRange('23.0.0', '22.x'), false);
});

test('returns null — never a false failure — when it cannot parse', () => {
	// A wrong `false` would tell an operator to upgrade a Node that is fine.
	assert.equal(satisfiesNodeRange('22.0.0', 'lts/*'), null);
	assert.equal(satisfiesNodeRange('not-a-version', '>=22.0.0'), null);
	assert.equal(satisfiesNodeRange('22.0.0', ''), null);
});

test('agrees with @selvajs/server satisfiesRange on the shared cases', () => {
	// The two implementations are duplicated by necessity; if they diverge, the
	// admin UI and the CLI would disagree about the same deployment.
	const cases = [
		['20.20.2', '>=22.0.0', false],
		['22.0.0', '>=22.0.0', true],
		['22.5.0', '^22.0.0', true],
		['23.0.0', '^22.0.0', false],
		['20.0.0', '>=18 <21', true],
		['22.0.0', 'lts/*', null]
	];
	for (const [version, range, expected] of cases) {
		assert.equal(satisfiesNodeRange(version, range), expected, `${version} vs ${range}`);
	}
});

// ── The floor itself must not be hardcoded ──────────────────────────────

test('requiredNodeRange reads the CLI package.json, not a copy in code', async () => {
	const { requiredNodeRange } = await import('../paths.js');
	const { readFileSync } = await import('node:fs');
	const { join, dirname } = await import('node:path');
	const { fileURLToPath } = await import('node:url');

	const here = dirname(fileURLToPath(import.meta.url));
	const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));

	// If someone bumps engines.node, this follows automatically. A hardcoded
	// literal anywhere in the scaffolder would fail here.
	assert.equal(requiredNodeRange(), pkg.engines.node);
});

test('the create-time guard tracks a bumped floor', async () => {
	const { requiredNodeRange } = await import('../paths.js');
	const range = requiredNodeRange();
	assert.ok(range, 'engines.node must be declared for the scaffolder to enforce it');

	// The floor is whatever package.json says; a host below it is refused.
	const floorMajor = Number(/(\d+)/.exec(range)[1]);
	assert.equal(satisfiesNodeRange(`${floorMajor - 1}.0.0`, range), false);
	assert.equal(satisfiesNodeRange(`${floorMajor}.0.0`, range), true);
});
