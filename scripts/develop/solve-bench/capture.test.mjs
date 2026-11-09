// Run: node --test scripts/develop/solve-bench/capture.test.mjs
//
// The proxy runs against a stand-in compute on localhost, so no case needs Rhino.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startCapture } from './capture.mjs';
import { sessionLogId } from './lib.mjs';

const out = mkdtempSync(path.join(tmpdir(), 'solve-bench-capture-'));
const mesh = 'm'.repeat(6000);
let hangups = 0;

const upstream = createServer((req, res) => {
	if (req.url === '/slow') {
		req.on('close', () => hangups++);
		return; // never answers: the client hangs up
	}
	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', () => {
		const body = JSON.stringify({
			values: [
				{ ParamName: 'Mesh', InnerTree: { '{0}': [{ type: 'System.String', data: mesh }] } },
				{ ParamName: 'Area', InnerTree: {} }
			],
			errors: []
		});
		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Content-Encoding': 'gzip',
			'Server-Timing': 'solve;dur=12, gh;dur=10, recomputed;desc="3/9"'
		});
		res.end(gzipSync(body));
	});
});
upstream.listen(0);
await once(upstream, 'listening');

writeFileSync(path.join(out, 'sessions.json'), JSON.stringify({ sid1: 'admin/bench' }));
const capture = await startCapture({
	port: 0,
	upstream: `http://localhost:${upstream.address().port}`,
	out
});

after(() => {
	capture.server.close();
	upstream.close();
	rmSync(out, { recursive: true, force: true });
});

function post(pathname, body, headers = {}) {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: 'localhost',
				port: capture.port,
				method: 'POST',
				path: pathname,
				headers: { 'Content-Type': 'application/json', ...headers }
			},
			(res) => {
				const chunks = [];
				res.on('data', (c) => chunks.push(c));
				res.on('end', () =>
					resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
				);
			}
		);
		req.on('error', reject);
		req.end(JSON.stringify(body));
	});
}

const rows = () =>
	readFileSync(capture.jsonl, 'utf8')
		.trim()
		.split('\n')
		.map((l) => JSON.parse(l));

test('forwards a solve unchanged and records it', async () => {
	const values = [
		{ ParamName: 'Shape', InnerTree: { '{0}': [{ type: 'System.Double', data: '0.5' }] } }
	];
	const res = await post('/grasshopper', { pointer: 'abc', values }, { 'X-Session-Id': 'sid1' });
	assert.equal(res.status, 200);
	assert.equal(res.headers['content-encoding'], 'gzip');

	const [row] = rows();
	assert.equal(row.session, 'admin/bench');
	assert.equal(row.logId, sessionLogId('sid1'));
	assert.deepEqual(row.inputs, { Shape: 0.5 });
	assert.equal(row.timing.recomputed, '3/9');
	assert.equal(row.outputs.Mesh.bytes, mesh.length);
	assert.deepEqual(row.emptyOutputs, ['Area']);
	assert.equal(row.dedupe.unchangedBytes, 0);
});

test('a repeated output counts as dedupable for the same session only', async () => {
	await post('/grasshopper', { pointer: 'abc', values: [] }, { 'X-Session-Id': 'sid1' });
	await post('/grasshopper', { pointer: 'abc', values: [] });
	const [, second, anonymous] = rows();
	assert.equal(second.dedupe.unchangedBytes, mesh.length);
	assert.equal(anonymous.session, null);
	assert.equal(anonymous.dedupe.unchangedBytes, 0);
});

test('a client that hangs up closes the upstream request too', async () => {
	await new Promise((resolve) => {
		const req = request({ host: 'localhost', port: capture.port, method: 'POST', path: '/slow' });
		req.on('error', () => {});
		req.end('{}', () => setTimeout(() => (req.destroy(), resolve()), 100));
	});
	for (let i = 0; i < 50 && hangups === 0; i++) await new Promise((r) => setTimeout(r, 20));
	assert.equal(hangups, 1);
});
