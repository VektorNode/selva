#!/usr/bin/env node

// Drives scenarios through Selva's real solve API as signed-in users and share-link visitors,
// so the session header, Selva's caches and its gzip are all in the path. Records one JSONL row
// per solve and prints a summary.
//
//   node scripts/develop/solve-bench/run.mjs <scenario> [--profile bench] [--rounds 6] ...
//
// Scenarios: setup, inputs, sweep, alternate, crowd, idle. See README.md.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import {
	DEFAULT_OUT,
	ROOT,
	SelvaSession,
	computeLogFiles,
	hmacKey,
	joinRouting,
	mb,
	median,
	parseRecomputed,
	parseServerTiming,
	pickValue,
	readRouting,
	round,
	sessionId,
	sessionLogId,
	table,
	userBase
} from './lib.mjs';
import { PROFILES } from './profiles.mjs';

// ============================================================================
// Args
// ============================================================================

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		profile: { type: 'string', default: 'bench' },
		definition: { type: 'string' },
		guid: { type: 'string' },
		rounds: { type: 'string', default: '6' },
		users: { type: 'string' },
		'idle-minutes': { type: 'string', default: '10' },
		base: { type: 'string', default: 'http://localhost:5273' },
		compute: { type: 'string' },
		password: {
			type: 'string',
			default: process.env.SOLVE_BENCH_PASSWORD ?? 'solve-bench-password'
		},
		out: { type: 'string', default: DEFAULT_OUT },
		label: { type: 'string', default: '' },
		'compute-logs': { type: 'string' }
	}
});

const SCENARIOS = ['setup', 'inputs', 'sweep', 'alternate', 'crowd', 'idle'];
const scenario = positionals[0];
if (!SCENARIOS.includes(scenario)) {
	console.error(`Usage: run.mjs <${SCENARIOS.join('|')}> [--profile bench] [--rounds 6]`);
	process.exit(1);
}

const profile = PROFILES[opts.profile] ?? JSON.parse(readFileSync(opts.profile, 'utf8'));
const profileName = PROFILES[opts.profile] ? opts.profile : path.basename(opts.profile, '.json');
const rounds = Number(opts.rounds);
const USERS = [
	{ name: 'admin', email: 'admin@dev.local' },
	{ name: 'member', email: 'member@dev.local' },
	{ name: 'member2', email: 'member2@dev.local' }
];
const usersNeeded = Number(opts.users ?? { alternate: 2, crowd: 3 }[scenario] ?? 1);

mkdirSync(opts.out, { recursive: true });
const statePath = path.join(opts.out, 'state.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
if (state.base !== opts.base) Object.assign(state, { base: opts.base, users: {}, definitions: {} });
const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, '\t'));

// ============================================================================
// Seeding: users, compute server, definition, share link
// ============================================================================

async function signIn(user, orgId) {
	const saved = state.users[user.name];
	const s = new SelvaSession(opts.base, saved?.cookies);
	if (saved && (await s.signedIn())) return s;

	const password = opts.password;
	await s.request('/login', { method: 'POST', form: { email: user.email, password } });
	if (await s.signedIn()) return s;

	if (user.name === 'admin') {
		await s.request('/setup', {
			method: 'POST',
			form: {
				companyName: 'Solve bench',
				displayName: 'Admin',
				email: user.email,
				password,
				confirm: password
			}
		});
		if (await s.signedIn()) return s;
		throw new Error(
			`Can't sign in ${user.email}: wrong --password for an existing store, or setup refused.`
		);
	}

	const admin = sessions.admin;
	const invite = await admin.json(`/api/v1/orgs/${orgId}/invites`, {
		method: 'POST',
		json: { email: user.email }
	});
	const token = new URL(invite.acceptUrl).searchParams.get('token');
	await s.request('/accept-invite', {
		method: 'POST',
		form: { token, password, confirm: password, displayName: user.name }
	});
	if (await s.signedIn()) return s;
	throw new Error(`Invite for ${user.email} was not accepted.`);
}

const sessions = {};

async function ensureUsers(count) {
	for (const user of USERS.slice(0, count)) {
		const orgId = state.orgId;
		const s = await signIn(user, orgId);
		sessions[user.name] = s;
		const me = await s.json('/api/v1/me');
		state.users[user.name] = { email: user.email, userId: me.userId, cookies: s.cookies };
		if (user.name === 'admin') state.orgId = me.actingOrgId;
		saveState();
	}
}

async function ensureCompute() {
	if (!opts.compute) return;
	// The id is fixed so reruns replace the same server instead of adding one.
	const id = '5e1fbe9c-0000-4000-8000-000000000b01';
	await sessions.admin.json('/api/admin/compute', {
		method: 'PUT',
		json: {
			servers: [{ id, label: 'Solve bench compute', serverUrl: opts.compute, sharedWith: 'all' }],
			defaultServerId: id
		}
	});
	console.log(`compute server → ${opts.compute}`);
}

async function ensureDefinition() {
	if (opts.guid) {
		state.definitions[profileName] = { ...state.definitions[profileName], guid: opts.guid };
	} else {
		const file = path.resolve(ROOT, opts.definition ?? profile.file);
		const bytes = readFileSync(file);
		const sha = createHash('sha256').update(bytes).digest('hex');
		const known = state.definitions[profileName];
		if (known?.sha !== sha) {
			const admin = sessions.admin;
			const list = await admin.json('/api/v1/projects');
			const projects = Array.isArray(list) ? list : (list.items ?? list.data ?? []);
			const project =
				projects.find((p) => p.name === 'Solve bench') ??
				(await admin.json('/api/v1/projects', {
					method: 'POST',
					json: { name: 'Solve bench', visibility: 'org' }
				}));
			const form = new FormData();
			form.set('file', new Blob([bytes]), path.basename(file));
			form.set('displayName', `${profileName} (solve bench)`);
			form.set('projectId', project.id);
			const created = await admin.json('/api/v1/definitions', { method: 'POST', body: form });
			await admin.json(`/api/v1/definitions/${created.guid}/publish`, { method: 'POST', json: {} });
			state.definitions[profileName] = { file, sha, guid: created.guid };
			console.log(`uploaded ${path.basename(file)} → ${created.guid}`);
		}
	}
	const def = state.definitions[profileName];
	if (!def.shareToken) {
		try {
			const link = await sessions.admin.json(`/api/v1/definitions/${def.guid}/share-links`, {
				method: 'POST',
				json: { name: 'solve bench', maxSolves: null }
			});
			def.shareToken = link.token;
		} catch (err) {
			console.warn(
				`no share link (is SELVA_FLAG_ENABLE_SHARING on?): ${err.message.slice(0, 120)}`
			);
		}
	}
	saveState();
	return def;
}

/** Maps every session id the capture proxy can see to `user/profile`. */
function writeSessionNames() {
	const key = hmacKey();
	const names = {};
	for (const [user, u] of Object.entries(state.users))
		for (const [prof, d] of Object.entries(state.definitions))
			if (u.userId && d.guid) names[sessionId(key, u.userId, d.guid)] = `${user}/${prof}`;
	writeFileSync(path.join(opts.out, 'sessions.json'), JSON.stringify(names, null, '\t'));
}

async function inputIds(guid) {
	const schema = await sessions.admin.json(`/api/v1/definitions/${guid}/schema`);
	const ids = Object.fromEntries((schema.inputs ?? []).map((i) => [i.nickname, i.id]));
	const missing = [
		...new Set([...Object.keys(profile.base), ...Object.keys(profile.inputs)])
	].filter((n) => !(n in ids));
	if (missing.length)
		console.warn(`not in the definition's schema, ignored: ${missing.join(', ')}`);
	return ids;
}

// ============================================================================
// Solving
// ============================================================================

const key = hmacKey();
const records = [];
let runFile;

/** One solve through `/api/v1/compute`, the endpoint the browser uses. `user` null = share link. */
async function solve(ctx, { user, person, values, changed, group, warmup = false }) {
	const { def, ids } = ctx;
	const byId = Object.fromEntries(
		Object.entries(values)
			.filter(([n]) => n in ids)
			.map(([n, v]) => [ids[n], v])
	);
	const session = user ? sessions[user] : new SelvaSession(opts.base);
	const query = user ? '' : `?token=${encodeURIComponent(def.shareToken)}`;
	const t0 = performance.now();
	const res = await session.request(`/api/v1/compute${query}`, {
		method: 'POST',
		json: { definitionUrl: `local:${def.guid}`, values: byId, channel: 'live' },
		headers: { 'Accept-Encoding': 'gzip' }
	});
	const text = await res.text();
	const ms = performance.now() - t0;
	const timing = parseServerTiming(res.headers.get('server-timing'));
	let body = {};
	try {
		body = JSON.parse(text);
	} catch {
		// An error page: the row keeps status and timing.
	}
	const outputs = body.values ?? [];
	const empty = outputs
		.filter((o) => Object.keys(o.InnerTree ?? {}).length === 0)
		.map((o) => o.ParamName);
	const userId = user ? state.users[user].userId : null;
	const record = {
		scenario,
		label: opts.label,
		profile: profileName,
		group,
		warmup,
		at: new Date().toISOString(),
		user: user ?? person ?? 'share link',
		signedIn: Boolean(user),
		changed,
		value: changed ? values[changed] : null,
		values,
		status: res.status,
		ms: round(ms),
		bytes: text.length,
		wireBytes: Number(res.headers.get('content-length')) || null,
		timing,
		// Selva's own verdict: compute's timing entries are missing from a server that sends none.
		reachedCompute: timing.selva_cache === 0,
		// Reached compute, and so its routing, but solved nothing.
		computeCached: timing.rhino_cache === 1,
		recomputed: parseRecomputed(timing.rhino_recomputed),
		outputs: outputs.length,
		emptyOutputs: empty,
		errors: body.errors?.length ?? 0,
		logId: userId ? sessionLogId(sessionId(key, userId, def.guid)) : null
	};
	records.push(record);
	if (res.status !== 200) console.warn(`solve ${res.status}: ${text.slice(0, 200)}`);
	return record;
}

function finish(groupBy = (r) => r.group) {
	const since = scenarioStart.toTimeString().slice(0, 8);
	const routing = readRouting(
		opts['compute-logs'] ? [opts['compute-logs']] : computeLogFiles(),
		since
	);
	joinRouting(records, routing);
	for (const r of records) appendFileSync(runFile, JSON.stringify(r) + '\n');

	const groups = new Map();
	for (const r of records.filter((r) => !r.warmup)) {
		const k = groupBy(r);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(r);
	}
	const rows = [...groups].map(([group, rs]) => {
		const solved = rs.filter((r) => r.reachedCompute && !r.computeCached);
		const routes = {};
		for (const r of rs) if (r.routing) routes[r.routing] = (routes[r.routing] ?? 0) + 1;
		return {
			group,
			n: rs.length,
			cached: rs.length - solved.length,
			ms: round(median(solved.map((r) => r.ms))),
			'selva solve': round(median(solved.map((r) => r.timing.solve))),
			gzip: round(median(solved.map((r) => r.timing.gzip))),
			gh: round(median(solved.map((r) => r.timing.rhino_gh))),
			recomputed:
				median(solved.map((r) => r.recomputed && r.recomputed.ran / r.recomputed.total))?.toFixed(
					2
				) ?? null,
			MB: mb(median(solved.map((r) => r.bytes))),
			empty: rs.filter((r) => r.emptyOutputs.length).length,
			routing: Object.entries(routes)
				.map(([k, v]) => `${k} ${v}`)
				.join(', ')
		};
	});
	console.log(
		`\n${scenario} on ${profileName}${opts.label ? ` (${opts.label})` : ''}: medians over solves that reached compute`
	);
	console.log(
		table(rows, [
			'group',
			'n',
			'cached',
			'ms',
			'selva solve',
			'gzip',
			'gh',
			'recomputed',
			'MB',
			'empty',
			'routing'
		])
	);
	console.log(`\nrows: ${runFile}`);
}

// ============================================================================
// Scenarios
// ============================================================================

/** Changes `input` in `current` and solves. */
function step(ctx, user, current, input, group, person) {
	const spec = profile.inputs[input];
	if (!spec) throw new Error(`profile has no range for input "${input}"`);
	current[input] = pickValue(spec, current[input]);
	return solve(ctx, { user, person, values: { ...current }, changed: input, group });
}

const scenarios = {
	async setup() {
		console.log(
			`users: ${Object.keys(state.users).join(', ')}; definition ${state.definitions[profileName].guid}`
		);
	},

	// Each input class on its own: what a colour, shape or files change costs end to end.
	async inputs(ctx) {
		const current = userBase(profile, 0);
		await solve(ctx, { user: 'admin', values: { ...current }, group: 'warmup', warmup: true });
		for (const input of profile.classes.filter((i) => i in ctx.ids))
			for (let i = 0; i < rounds; i++) await step(ctx, 'admin', current, input, input);
		finish();
	},

	// The payload sweep: at each size, the cost of one cheap change.
	async sweep(ctx) {
		const { input, values, change } = profile.sweep ?? {};
		if (!input) throw new Error('profile has no sweep');
		const current = userBase(profile, 0);
		for (const v of values) {
			current[input] = v;
			await solve(ctx, {
				user: 'admin',
				values: { ...current },
				changed: input,
				group: `${input} ${v}`,
				warmup: true
			});
			for (let i = 0; i < rounds; i++) await step(ctx, 'admin', current, change, `${input} ${v}`);
		}
		finish();
	},

	// Two people taking turns: signed in (header sent) against share-link visitors (none).
	async alternate(ctx) {
		const people = USERS.slice(0, 2).map((u) => u.name);
		for (const mode of ['signed in', 'share link']) {
			if (mode === 'share link' && !ctx.def.shareToken) {
				console.warn('share-link half skipped: no share link');
				continue;
			}
			const current = people.map((_, i) => userBase(profile, i));
			const who = (i) => (mode === 'signed in' ? people[i] : null);
			const visitor = (i) => `visitor ${i + 1}`;
			for (let i = 0; i < people.length; i++)
				await solve(ctx, {
					user: who(i),
					person: visitor(i),
					values: { ...current[i] },
					group: mode,
					warmup: true
				});
			for (let r = 0; r < rounds; r++)
				for (let i = 0; i < people.length; i++)
					await step(ctx, who(i), current[i], profile.vary, mode, visitor(i));
		}
		finish();
	},

	// More users than children: how often they evict each other's documents.
	async crowd(ctx) {
		const people = USERS.slice(0, usersNeeded).map((u) => u.name);
		const current = people.map((_, i) => userBase(profile, i));
		for (let i = 0; i < people.length; i++)
			await solve(ctx, {
				user: people[i],
				values: { ...current[i] },
				group: people[i],
				warmup: true
			});
		for (let r = 0; r < rounds; r++)
			for (let i = 0; i < people.length; i++)
				await step(ctx, people[i], current[i], profile.vary, people[i]);
		finish();
	},

	// Solve, leave compute idle, solve again: does the child still return outputs?
	async idle(ctx) {
		const minutes = Number(opts['idle-minutes']);
		const current = userBase(profile, 0);
		await step(ctx, 'admin', current, profile.vary, 'before idle');
		console.log(`idle ${minutes} min...`);
		await sleep(minutes * 60_000);
		await step(ctx, 'admin', current, profile.vary, `after ${minutes} min idle`);
		finish();
	}
};

// ============================================================================
// Main
// ============================================================================

const scenarioStart = new Date();
await ensureUsers(Math.max(usersNeeded, 1));
await ensureCompute();
const def = await ensureDefinition();
writeSessionNames();
const ids = await inputIds(def.guid);
mkdirSync(path.join(opts.out, 'runs'), { recursive: true });
runFile = path.join(
	opts.out,
	'runs',
	`${scenarioStart.toISOString().replace(/[:.]/g, '-')}-${scenario}-${profileName}${opts.label ? `-${opts.label}` : ''}.jsonl`
);
await scenarios[scenario]({ def, ids });
