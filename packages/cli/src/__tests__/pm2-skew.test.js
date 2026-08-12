// PM2 daemon/CLI skew direction (issue #118, defect 2).
//
// The old check treated any `out-of-date` report as "run `pm2 update`". That is
// only correct when the daemon is OLDER than the deployment-local CLI. In the
// reported incident a global pm2 v6 owned the daemon while the deployment pinned
// v5.4.3 — `pm2 update` ran the v5 CLI against it, downgrading the daemon and
// feeding it a v6 dump, so the process table came back empty and selva-compute
// was never re-registered.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePm2Skew, daemonOutranksCli } from '../commands/pm2.js';

// pm2 colourises through chalk on a TTY; build the codes rather than embedding
// raw control characters in the source.
const ESC = String.fromCharCode(27);
const colour = (s) => `${ESC}[34m${ESC}[1m${s}${ESC}[22m${ESC}[39m`;

const REAL_OUTPUT =
	`${ESC}[31m${ESC}[1m>>>> In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update${ESC}[22m${ESC}[39m\n` +
	`In memory PM2 version: ${colour('6.0.14')}\n` +
	`Local PM2 version: ${colour('5.4.3')}\n`;

test('parses both versions out of real colourised pm2 output', () => {
	assert.deepEqual(parsePm2Skew(REAL_OUTPUT), { daemon: '6.0.14', local: '5.4.3' });
});

test('parses plain uncoloured output (non-TTY)', () => {
	const plain = 'In memory PM2 version: 5.4.3\nLocal PM2 version: 5.4.3\n';
	assert.deepEqual(parsePm2Skew(plain), { daemon: '5.4.3', local: '5.4.3' });
});

test('returns nulls when the message shape changes, so callers fall back to resync', () => {
	assert.deepEqual(parsePm2Skew('something else entirely'), { daemon: null, local: null });
});

test('flags the incident direction — global daemon newer than the pinned CLI', () => {
	assert.equal(daemonOutranksCli('6.0.14', '5.4.3'), true);
});

test('allows the repairable direction — daemon older than the CLI', () => {
	assert.equal(daemonOutranksCli('5.4.3', '6.0.14'), false);
});

test('is false when the versions match', () => {
	assert.equal(daemonOutranksCli('5.4.3', '5.4.3'), false);
});

test('compares minor and patch, not just major', () => {
	assert.equal(daemonOutranksCli('5.5.0', '5.4.3'), true);
	assert.equal(daemonOutranksCli('5.4.4', '5.4.3'), true);
	assert.equal(daemonOutranksCli('5.4.3', '5.4.4'), false);
});

test('never blocks on an unparseable version — resync stays the default', () => {
	assert.equal(daemonOutranksCli(null, '5.4.3'), false);
	assert.equal(daemonOutranksCli('6.0.14', null), false);
});
