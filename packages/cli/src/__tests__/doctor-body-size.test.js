// BODY_SIZE_LIMIT is the one cap whose failure mode is invisible from the app:
// adapter-node rejects the request before SvelteKit sees it, with a non-JSON
// body and no app-side log. A deployment misconfigured here looks healthy until
// someone uploads a large file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBodySizeLimit, parseBodySizeLimit } from '../checks/config.js';

const MB = 1024 * 1024;

test('unset is red, not neutral — the fallback is 512 KB', () => {
	// The reported incident: a scaffolded .env with no BODY_SIZE_LIMIT line, so
	// every upload 413s on a deployment that otherwise passes every check.
	const r = checkBodySizeLimit({});
	assert.equal(r.severity, 'red');
	assert.match(r.line, /512 KB/);
});

test('a limit at or above the compute request cap passes', () => {
	assert.equal(checkBodySizeLimit({ BODY_SIZE_LIMIT: '256M' }).severity, 'green');
	assert.equal(checkBodySizeLimit({ BODY_SIZE_LIMIT: '512M' }).severity, 'green');
});

test('a limit below the compute request cap is flagged as dead config', () => {
	// The second reported incident: BODY_SIZE_LIMIT=210M left over from an older
	// release, under the 256 MB request cap, so the compute cap never applies.
	const r = checkBodySizeLimit({ BODY_SIZE_LIMIT: '210M' });
	assert.equal(r.severity, 'yellow');
	assert.match(r.line, /210 MB/);
	assert.match(r.line, /256 MB/);
});

test('the comparison honours an overridden COMPUTE_REQUEST_MAX_BYTES', () => {
	const env = { BODY_SIZE_LIMIT: '210M', COMPUTE_REQUEST_MAX_BYTES: String(100 * MB) };
	assert.equal(checkBodySizeLimit(env).severity, 'green');
});

test('a value adapter-node throws on is red, not silently accepted', () => {
	for (const bad of ['Infinity', 'lots', '256MB!', '-1']) {
		const r = checkBodySizeLimit({ BODY_SIZE_LIMIT: bad });
		assert.equal(r.severity, 'red', `${bad} should be rejected`);
	}
});

// Mirrors adapter-node's parse_as_bytes (files/utils.js). Agreeing with it is
// the whole point — a check that parsed "more correctly" would disagree with
// the thing actually doing the rejecting.
test('parses suffixes the way adapter-node does', () => {
	assert.equal(parseBodySizeLimit('256M'), 256 * MB);
	assert.equal(parseBodySizeLimit('256m'), 256 * MB);
	assert.equal(parseBodySizeLimit('512K'), 512 * 1024);
	assert.equal(parseBodySizeLimit('1G'), 1024 * MB);
	assert.equal(parseBodySizeLimit('268435456'), 268435456);
});

test('"256mb" is NaN to adapter-node, so the app throws on boot', () => {
	// Only K/M/G are units, and the remainder goes through `Number`. "b" is not a
	// unit, so the whole "256mb" is parsed and yields NaN — a boot crash, not a
	// silently wrong limit. Catching it in doctor beats reading a stack trace.
	assert.equal(parseBodySizeLimit('256mb'), null);
	assert.equal(checkBodySizeLimit({ BODY_SIZE_LIMIT: '256mb' }).severity, 'red');
});

test('unparseable values return null rather than NaN', () => {
	for (const bad of ['', '   ', 'Infinity', 'abc', '12.5MB']) {
		assert.equal(parseBodySizeLimit(bad), null, `${JSON.stringify(bad)} should be null`);
	}
});

test('a fractional suffix value is honoured — Number, not parseInt', () => {
	assert.equal(parseBodySizeLimit('1.5M'), 1.5 * MB);
});
