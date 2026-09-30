// Stands in for Selva's POST /api/v1/solve-events/:solveId. Logs every batch as one JSON line to
// sink.log and answers per the mode set with POST /control:
//   { mode: "ok" }                       -> 200 {abort:false}
//   { mode: "abort", afterMs: 1500 }     -> 200 {abort:true} once the solve is older than afterMs
//   { mode: "gone",  afterMs: 1500 }     -> 410 once the solve is older than afterMs
import http from 'node:http';
import fs from 'node:fs';

const PORT = 5199;
const LOG = new URL("./sink.log", import.meta.url);
let control = { mode: 'ok', afterMs: 0 };
const firstSeen = new Map();
const t0 = Date.now();

const read = (req) =>
	new Promise((resolve) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => resolve(body));
	});

http
	.createServer(async (req, res) => {
		const body = await read(req);
		if (req.url === '/control') {
			control = { afterMs: 0, ...JSON.parse(body || '{}') };
			fs.appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, control }) + '\n');
			firstSeen.clear();
			res.end('ok');
			return;
		}
		const solveId = req.url.split('/').pop();
		if (!firstSeen.has(solveId)) firstSeen.set(solveId, Date.now());
		const age = Date.now() - firstSeen.get(solveId);
		const due = age >= control.afterMs;
		let status = 200;
		let reply = { abort: false };
		if (control.mode === 'abort' && due) reply = { abort: true };
		if (control.mode === 'gone' && due) status = 410;

		let events = [];
		try {
			events = JSON.parse(body).events ?? [];
		} catch {}
		fs.appendFileSync(
			LOG,
			JSON.stringify({
				t: Date.now() - t0,
				solveId: solveId.slice(0, 8),
				auth: req.headers.authorization ?? null,
				n: events.length,
				events: events.map((e) => `${e.seq}:${e.type}:${e.payload?.level ?? ''}:${e.payload?.message ?? ''}`),
				status,
				reply
			}) + '\n'
		);
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(status === 200 ? JSON.stringify(reply) : '{"error":"gone"}');
	})
	.listen(PORT, '127.0.0.1', () => console.log(`sink on http://127.0.0.1:${PORT}`));
