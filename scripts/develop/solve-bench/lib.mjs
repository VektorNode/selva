// Shared by capture.mjs, run.mjs and browser.mjs: session ids, Server-Timing,
// output summaries, the dedupe estimate, compute's routing log, value profiles
// and a small Selva API client.

import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const DEFAULT_OUT = path.join(HERE, 'out');

// ============================================================================
// Session ids
// ============================================================================

/** The HMAC key Selva derives session ids with: env first, else the dev-local file. */
export function hmacKey(env = process.env) {
	if (env.SELVA_HMAC_KEY) return env.SELVA_HMAC_KEY;
	const file = path.join(ROOT, 'packages', 'selva', '.env.dev-local');
	const line = readFileSync(file, 'utf8')
		.split(/\r?\n/)
		.find((l) => l.startsWith('SELVA_HMAC_KEY='));
	if (!line) throw new Error(`SELVA_HMAC_KEY is not set and ${file} has none`);
	return line.slice('SELVA_HMAC_KEY='.length).replace(/^"|"$/g, '');
}

/** Must match `computeSessionId` in packages/selva/src/lib/server/compute/sessionId.server.ts. */
export function sessionId(key, userId, definitionGuid) {
	return createHmac('sha256', key)
		.update(`compute-session\0${userId}\0${definitionGuid}`)
		.digest('hex')
		.slice(0, 32);
}

/** The 8-character id compute's Debug log prints for a session. */
export function sessionLogId(id) {
	return createHash('sha256').update(id).digest('hex').slice(0, 8).toUpperCase();
}

// ============================================================================
// Server-Timing
// ============================================================================

/** `a;dur=1.5, b;desc="45/204", c` → `{ a: 1.5, b: '45/204', c: true }`. */
export function parseServerTiming(header) {
	const out = {};
	for (const part of (header ?? '').split(',')) {
		const [name, ...params] = part.trim().split(';');
		if (!name) continue;
		const dur = params.find((p) => p.trim().startsWith('dur='));
		const desc = params.find((p) => p.trim().startsWith('desc='));
		out[name] = dur
			? Number(dur.trim().slice(4))
			: desc
				? desc.trim().slice(5).replace(/^"|"$/g, '')
				: true;
	}
	return out;
}

/** `'45/204'` → `{ ran: 45, total: 204 }`, else null. */
export function parseRecomputed(value) {
	const m = /^(\d+)\/(\d+)$/.exec(String(value ?? ''));
	return m ? { ran: Number(m[1]), total: Number(m[2]) } : null;
}

// ============================================================================
// Data trees
// ============================================================================

function itemValue(item) {
	try {
		return JSON.parse(item.data);
	} catch {
		return item.data;
	}
}

/** A request's input trees as `{ name: value }`: one item unwrapped, several as an array. */
export function inputSummary(trees) {
	const out = {};
	for (const tree of trees ?? []) {
		const values = Object.values(tree.InnerTree ?? {})
			.flat()
			.map(itemValue);
		out[tree.ParamName] = values.length === 0 ? null : values.length === 1 ? values[0] : values;
	}
	return out;
}

/** Bytes and item count per output, per branch path. */
export function outputSummary(trees) {
	const out = {};
	for (const tree of trees ?? []) {
		const branches = {};
		let bytes = 0;
		let items = 0;
		for (const [branch, list] of Object.entries(tree.InnerTree ?? {})) {
			const b = list.reduce((s, i) => s + (i.data?.length ?? 0), 0);
			branches[branch] = { items: list.length, bytes: b };
			bytes += b;
			items += list.length;
		}
		out[tree.ParamName] = { items, bytes, branches };
	}
	return out;
}

// ============================================================================
// Dedupe estimate
// ============================================================================

// Below this, a hash costs more than resending the item.
export const DEDUPE_MIN_BYTES = 4096;

export function itemHash(data) {
	return createHash('sha256').update(data).digest('hex').slice(0, 32);
}

/**
 * Per session, what a whole-item dedupe would have skipped: items above the threshold whose
 * hash was in the session's previous `keep` responses.
 */
export function createDedupeTracker({ keep = 2, minBytes = DEDUPE_MIN_BYTES } = {}) {
	const recent = new Map();
	return {
		measure(session, trees) {
			const known = new Set((recent.get(session) ?? []).flatMap((set) => [...set]));
			const seen = new Set();
			const perOutput = {};
			let totalBytes = 0;
			let unchangedBytes = 0;
			for (const tree of trees ?? []) {
				for (const [branch, list] of Object.entries(tree.InnerTree ?? {})) {
					for (const item of list) {
						const size = item.data?.length ?? 0;
						totalBytes += size;
						if (size < minBytes) continue;
						const hash = itemHash(item.data);
						seen.add(hash);
						const same = known.has(hash);
						if (same) unchangedBytes += size;
						const o = (perOutput[tree.ParamName] ??= { unchanged: 0, changed: 0, branches: {} });
						o[same ? 'unchanged' : 'changed'] += size;
						(o.branches[branch] ??= []).push({ hash, bytes: size, unchanged: same });
					}
				}
			}
			recent.set(session, [...(recent.get(session) ?? []), seen].slice(-keep));
			return { totalBytes, unchangedBytes, perOutput };
		}
	};
}

// ============================================================================
// Compute's routing log
// ============================================================================

const ROUTED =
	/\[(\d\d:\d\d:\d\d) DBG\] Session ([0-9A-F]{8}) routed to compute\.geometry on port (\d+): (\w+)/;

export function parseRoutingLine(line) {
	const m = ROUTED.exec(line);
	return m ? { time: m[1], logId: m[2], port: Number(m[3]), outcome: m[4] } : null;
}

/** Today's rhino.compute log files: the proxy writes one per day, rolling to `_001` when locked. */
export function computeLogFiles(dir = path.join(tmpdir(), 'Compute', 'Logs'), date = new Date()) {
	const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.startsWith(`log-rhino-compute-${stamp}`) && f.endsWith('.txt'))
		.sort()
		.map((f) => path.join(dir, f));
}

/** Routing lines at or after `since` (`HH:MM:SS`), in log order. */
export function readRouting(files, since = '00:00:00') {
	const out = [];
	for (const file of files) {
		for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
			const r = parseRoutingLine(line);
			if (r && r.time >= since) out.push(r);
		}
	}
	return out;
}

/**
 * Pairs each solve that reached compute with its session's routing line, in order. A solve the
 * Selva cache answered never reached compute, so it takes no line.
 */
export function joinRouting(solves, routing) {
	const bySession = new Map();
	for (const r of routing) {
		if (!bySession.has(r.logId)) bySession.set(r.logId, []);
		bySession.get(r.logId).push(r);
	}
	for (const s of solves) {
		if (!s.logId || !s.reachedCompute) continue;
		const next = bySession.get(s.logId)?.shift();
		if (next) {
			s.routing = next.outcome;
			s.port = next.port;
		}
	}
	return solves;
}

// ============================================================================
// Value profiles
// ============================================================================

/**
 * A new value for one input spec: `{ min, max, integer }`, `{ values: [...] }`, `{ color: true }`
 * or `{ boolean: true }`. Differs from `current` when the spec allows it.
 */
export function pickValue(spec, current, random = Math.random) {
	for (let attempt = 0; attempt < 20; attempt++) {
		let v;
		if (spec.values) v = spec.values[Math.floor(random() * spec.values.length)];
		else if (spec.boolean) v = current === undefined ? random() < 0.5 : !current;
		else if (spec.color)
			v = `#${Math.floor(random() * 0xffffff)
				.toString(16)
				.padStart(6, '0')}`;
		else {
			const raw = spec.min + random() * (spec.max - spec.min);
			v = spec.integer ? Math.round(raw) : Number(raw.toFixed(spec.decimals ?? 4));
		}
		if (v !== current) return v;
	}
	return current;
}

/** The values one user starts from: the profile's base, then that user's overrides. */
export function userBase(profile, userIndex) {
	return { ...profile.base, ...(profile.perUser?.[userIndex] ?? {}) };
}

// ============================================================================
// Statistics
// ============================================================================

export function median(values) {
	const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
	if (v.length === 0) return null;
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function table(rows, columns) {
	const widths = columns.map((c) =>
		Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
	);
	const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
	return [
		line(columns),
		line(widths.map((w) => '-'.repeat(w))),
		...rows.map((r) => line(columns.map((c) => r[c])))
	].join('\n');
}

export const mb = (bytes) => (bytes == null ? null : Number((bytes / 1048576).toFixed(2)));
export const round = (x) => (x == null ? null : Math.round(x));

// ============================================================================
// Selva API client
// ============================================================================

/** One signed-in user: a cookie jar over fetch, with the Origin Selva's CSRF check wants. */
export class SelvaSession {
	constructor(base, cookies = {}) {
		this.base = base;
		this.cookies = { ...cookies };
	}

	async request(pathname, { method = 'GET', json, form, body, headers = {} } = {}) {
		const h = { Origin: this.base, ...headers };
		const jar = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`);
		if (jar.length) h.Cookie = jar.join('; ');
		let payload = body;
		if (json !== undefined) {
			h['Content-Type'] = 'application/json';
			payload = JSON.stringify(json);
		} else if (form) {
			h['Content-Type'] = 'application/x-www-form-urlencoded';
			payload = new URLSearchParams(form);
		}
		const res = await fetch(this.base + pathname, {
			method,
			headers: h,
			body: payload,
			redirect: 'manual'
		});
		for (const c of res.headers.getSetCookie()) {
			const [kv] = c.split(';');
			const i = kv.indexOf('=');
			const name = kv.slice(0, i);
			const value = kv.slice(i + 1);
			if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || value === '') delete this.cookies[name];
			else this.cookies[name] = value;
		}
		return res;
	}

	async json(pathname, init) {
		const res = await this.request(pathname, init);
		const text = await res.text();
		if (!res.ok)
			throw new Error(
				`${init?.method ?? 'GET'} ${pathname} → ${res.status}: ${text.slice(0, 300)}`
			);
		return text ? JSON.parse(text) : null;
	}

	/** True when the jar holds a session Selva still accepts. */
	async signedIn() {
		const res = await this.request('/api/v1/me');
		await res.body?.cancel();
		return res.ok;
	}
}
