// POSTs the live solve showcase to compute.geometry with a selvaevents block.
// Usage: node solve.mjs '<json inputs by nickname>' [--no-events] [--timeout ms]
//   node solve.mjs '{"Stage delay":1,"Get Integer":50}'
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const COMPUTE = process.env.COMPUTE_URL ?? 'http://localhost:6001/grasshopper';
const GHX = new URL('../../../../fixtures/grasshopper/live_solve_showcase.ghx', import.meta.url);
const args = process.argv.slice(2);
const inputs = JSON.parse(args.find((a) => a.startsWith('{')) ?? '{}');
const withEvents = !args.includes('--no-events');
const timeoutIdx = args.indexOf('--timeout');
const timeoutMs = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 60_000;

const typeOf = (v) =>
	typeof v === 'number' ? (Number.isInteger(v) ? 'System.Int32' : 'System.Double') : typeof v === 'boolean' ? 'System.Boolean' : 'System.String';
const values = Object.entries(inputs).map(([name, v]) => ({
	ParamName: name,
	InnerTree: { '{0}': [{ type: typeOf(v), data: typeof v === 'string' ? JSON.stringify(v) : String(v) }] }
}));

const solveId = randomUUID();
const body = {
	algo: fs.readFileSync(GHX).toString('base64'),
	pointer: null,
	values,
	...(withEvents
		? { selvaevents: { url: `http://127.0.0.1:5199/cb/${solveId}`, solveId, token: 'test-token' } }
		: {})
};

const t0 = Date.now();
const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), timeoutMs);
try {
	const res = await fetch(COMPUTE, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, signal: ctrl.signal });
	const text = await res.text();
	const json = JSON.parse(text);
	const vals = Object.fromEntries(
		(json.values ?? []).map((v) => {
			const first = Object.values(v.InnerTree ?? {})[0]?.[0];
			const data = first?.data ?? '';
			return [v.ParamName, data.length > 60 ? `${data.slice(0, 60)}…(${data.length})` : data];
		})
	);
	console.log(JSON.stringify({ solveId: solveId.slice(0, 8), status: res.status, ms: Date.now() - t0, errors: json.errors ?? [], warnings: json.warnings ?? [], selva: json.selva ?? null, bytes: text.length, values: vals }, null, 1));
} catch (e) {
	console.log(JSON.stringify({ solveId: solveId.slice(0, 8), ms: Date.now() - t0, clientError: String(e.name ?? e) }));
} finally {
	clearTimeout(timer);
}
