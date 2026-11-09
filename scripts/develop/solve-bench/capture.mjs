#!/usr/bin/env node

// A logging proxy between Selva and Rhino.Compute. Point Selva's compute server at it and every
// /grasshopper solve becomes one JSONL row: the inputs, the session, compute's Server-Timing,
// bytes per output and per branch, and what a whole-item dedupe would have skipped.
//
//   node scripts/develop/solve-bench/capture.mjs [--port 6600] [--upstream http://localhost:6500]
//                                               [--out <dir>] [--names <sessions.json>]
//
// Rows hold input values, so the default out dir is gitignored.

import http from 'node:http';
import zlib from 'node:zlib';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
	DEFAULT_OUT,
	createDedupeTracker,
	inputSummary,
	outputSummary,
	parseServerTiming,
	sessionLogId
} from './lib.mjs';

// ============================================================================
// Proxy
// ============================================================================

function decode(buf, encoding) {
	try {
		if (encoding === 'gzip') return zlib.gunzipSync(buf);
		if (encoding === 'br') return zlib.brotliDecompressSync(buf);
		if (encoding === 'deflate') return zlib.inflateSync(buf);
	} catch {
		// A body that doesn't decode is still forwarded; only its row loses detail.
	}
	return buf;
}

function readNames(file) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return {};
	}
}

/** Starts the proxy. Resolves once it listens, with the server and the port it took. */
export function startCapture({
	port = 6600,
	upstream = 'http://localhost:6500',
	out = DEFAULT_OUT,
	names
} = {}) {
	const target = new URL(upstream);
	const namesFile = names ?? path.join(out, 'sessions.json');
	if (!existsSync(out)) mkdirSync(out, { recursive: true });
	const jsonl = path.join(out, 'capture.jsonl');
	const log = path.join(out, 'capture.log');
	const dedupe = createDedupeTracker();
	let sessionNames = readNames(namesFile);
	let n = 0;

	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const body = Buffer.concat(chunks);
			const startedAt = new Date();
			const start = performance.now();
			const sid = req.headers['x-session-id'];
			const up = http.request(
				{
					host: target.hostname,
					port: target.port,
					method: req.method,
					path: req.url,
					headers: { ...req.headers, host: target.host }
				},
				(upRes) => {
					res.writeHead(upRes.statusCode, upRes.headers);
					const out = [];
					upRes.on('data', (c) => {
						out.push(c);
						res.write(c);
					});
					upRes.on('end', () => {
						res.end();
						const ms = Math.round(performance.now() - start);
						const isSolve =
							req.method === 'POST' &&
							req.url.startsWith('/grasshopper') &&
							!req.url.startsWith('/grasshopper/schema');
						if (!isSolve) {
							if (req.url !== '/idlespan')
								appendFileSync(
									log,
									`${startedAt.toISOString()} ${req.method} ${req.url} ${upRes.statusCode} ${ms}ms\n`
								);
							return;
						}
						const wire = Buffer.concat(out);
						let request = {};
						let response = {};
						try {
							request = JSON.parse(decode(body, req.headers['content-encoding']).toString());
						} catch {
							// Not JSON: the row keeps timings and sizes.
						}
						try {
							response = JSON.parse(decode(wire, upRes.headers['content-encoding']).toString());
						} catch {
							// As above.
						}
						if (sid && !sessionNames[sid]) sessionNames = readNames(namesFile);
						const outputs = outputSummary(response.values);
						const row = {
							n: ++n,
							at: startedAt.toISOString(),
							status: upRes.statusCode,
							session: sid ? (sessionNames[sid] ?? 'unknown') : null,
							logId: sid ? sessionLogId(sid) : null,
							definition: request.algo
								? { upload: request.algo.length }
								: request.pointer
									? { pointer: String(request.pointer).slice(0, 16) }
									: null,
							liveEvents: Boolean(request.selvaevents),
							inputs: inputSummary(request.values),
							ms,
							timing: parseServerTiming(upRes.headers['server-timing']),
							requestBytes: body.length,
							responseBytes: wire.length,
							outputs,
							emptyOutputs: Object.entries(outputs)
								.filter(([, o]) => o.items === 0)
								.map(([k]) => k),
							dedupe: dedupe.measure(sid ?? 'anonymous', response.values),
							errors: response.errors ?? [],
							warnings: response.warnings ?? []
						};
						appendFileSync(jsonl, JSON.stringify(row) + '\n');
						appendFileSync(log, describe(row));
					});
				}
			);
			up.on('error', (err) => {
				appendFileSync(
					log,
					`${startedAt.toISOString()} ${req.method} ${req.url} upstream error: ${err.message}\n`
				);
				if (!res.headersSent) res.writeHead(502).end('solve-bench capture: upstream error');
				else res.destroy();
			});
			// Selva hanging up has to reach compute, or RHINO_COMPUTE_ABORT_ON_HANGUP behaves
			// differently behind the proxy than without it.
			res.on('close', () => {
				if (!res.writableFinished) up.destroy();
			});
			up.end(body);
		});
	});

	return new Promise((resolve) => {
		server.listen(port, () => {
			const actual = server.address().port;
			appendFileSync(
				log,
				`--- capture on :${actual} → ${upstream}, ${new Date().toISOString()} ---\n`
			);
			resolve({ server, port: actual, jsonl, log });
		});
	});
}

const short = (v) => {
	const s = typeof v === 'string' ? v : JSON.stringify(v);
	return s.length > 48 ? `${s.slice(0, 45)}...` : s;
};

function describe(row) {
	const t = row.timing;
	const total = Object.keys(row.outputs).length;
	const mbOf = (b) => (b / 1048576).toFixed(1);
	const changed = Object.entries(row.dedupe.perOutput)
		.filter(([, o]) => o.changed)
		.map(([k, o]) => `${k} ${mbOf(o.changed)} MB`)
		.join(', ');
	return (
		`${row.at} #${row.n} ${row.status} session=${row.session ?? 'none'}${row.logId ? ` (${row.logId})` : ''} ` +
		`total=${row.ms}ms solve=${t.solve ?? '?'} gh=${t.gh ?? '?'} harvest=${t.harvest ?? '?'} encode=${t.encode ?? '?'} ` +
		`recomputed=${t.recomputed ?? '?'} out=${mbOf(row.responseBytes)} MB` +
		`${row.emptyOutputs.length ? ` EMPTY ${row.emptyOutputs.length}/${total}` : ''}${row.errors.length ? ` errors=${row.errors.length}` : ''}\n` +
		`    dedupe: ${mbOf(row.dedupe.unchangedBytes)} of ${mbOf(row.dedupe.totalBytes)} MB unchanged; changed: ${changed || 'none'}\n` +
		`    inputs: ${Object.entries(row.inputs)
			.map(([k, v]) => `${k}=${short(v)}`)
			.join(', ')}\n`
	);
}

// ============================================================================
// CLI
// ============================================================================

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const { values } = parseArgs({
		options: {
			port: { type: 'string', default: '6600' },
			upstream: { type: 'string', default: 'http://localhost:6500' },
			out: { type: 'string', default: DEFAULT_OUT },
			names: { type: 'string' }
		}
	});
	const { port, log } = await startCapture({
		port: Number(values.port),
		upstream: values.upstream,
		out: values.out,
		names: values.names
	});
	console.log(`capture on :${port} → ${values.upstream}; readable log: ${log}`);
}
