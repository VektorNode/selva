// Plan the .env rewrite `selva migrate` applies: old names renamed, values a
// looser reader used to accept rewritten to what they meant, no-op lines
// removed, shipped template prose stripped. Unknown keys are kept.
//
// `mismatches` is the proof: every declared key resolved from the old file
// (with the old readers' semantics) and from the new one. Anything but empty
// means the rewrite would change behaviour, and migrate refuses to write it.

import {
	countEnvCommentLines,
	parseEnv,
	RENAMED_ENV_VARS as RENAMES,
	renameEnvKeys,
	setEnvValues,
	stripEnvComments
} from './env.js';
import { ALL_SETTINGS, legacyValue, resolveConfig } from './generated/config.js';
import { reportFor } from './commands/config.js';

const SPECS = new Map(ALL_SETTINGS.map((s) => [s.key, s]));

// How the old reader took SELVA_FLAG_COMPUTE_DEBUG_VERBOSE (engine.server.ts).
const OLD_VERBOSE_TRUE = new Set(['true', '1', 'yes']);

/** The debug mode the app runs in, from either generation of the keys. */
function computeDebugMode(env) {
	const raw = (env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase();
	if (raw === 'verbose') return 'verbose';
	if (OLD_VERBOSE_TRUE.has((env.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE ?? '').toLowerCase()))
		return 'verbose';
	return ['true', '1', 'yes', 'on'].includes(raw) ? 'on' : 'off';
}

/** Keys whose effective value depends on another key. */
const EFFECTIVE = {
	HEADER_AUTH_DATA_DIR: (env) => env.HEADER_AUTH_DATA_DIR || env.DATA_PATH,
	SELVA_FLAG_COMPUTE_DEBUG: computeDebugMode,
	SELVA_FLAG_COMPUTE_DEBUG_VERBOSE: () => undefined
};

function canonical(value) {
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) return value.join(',');
	return String(value);
}

/** What `env[key]` means to the reader of that generation. */
function meaning(spec, env, { legacy }) {
	if (EFFECTIVE[spec.key]) return EFFECTIVE[spec.key](env);
	const name = [spec.key, ...(spec.aliases ?? [])].find(
		(k) => env[k] !== undefined && env[k] !== ''
	);
	if (name === undefined) return spec.default;
	const raw = env[name];
	if (legacy && spec.legacy) return legacyValue(spec, raw);
	return resolveConfig([spec], { [spec.key]: raw }).values[spec.key];
}

export function planEnvMigration(input) {
	const changes = [];
	let text = input;

	if (countEnvCommentLines(text) > 0) {
		text = stripEnvComments(text).text;
		changes.push({ key: '(comments)', action: 'stripped' });
	}

	const renamed = renameEnvKeys(text, RENAMES);
	text = renamed.text;
	for (const [from, to, how] of renamed.changes) {
		changes.push(
			how === 'renamed'
				? { key: from, action: 'renamed', to }
				: { key: from, action: 'dropped', reason: `${to} is set` }
		);
	}

	const env = parseEnv(text);
	const updates = {};

	if (env.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE !== undefined) {
		updates.SELVA_FLAG_COMPUTE_DEBUG_VERBOSE = undefined;
		if (computeDebugMode(env) === 'verbose') updates.SELVA_FLAG_COMPUTE_DEBUG = 'verbose';
		changes.push({
			key: 'SELVA_FLAG_COMPUTE_DEBUG_VERBOSE',
			action: 'replaced',
			to: 'SELVA_FLAG_COMPUTE_DEBUG'
		});
	}

	for (const [key, raw] of Object.entries(env)) {
		const spec = SPECS.get(key);
		if (!spec?.legacy) continue;
		const old = legacyValue(spec, raw);
		const now = resolveConfig([spec], { [key]: raw }).keys[key];
		if (now.status !== 'ok' || now.value !== old) {
			updates[key] = canonical(old);
			changes.push({ key, action: 'rewritten', to: canonical(old) });
		}
	}

	for (const key of [
		'HEADER_AUTH_UPN_HEADER',
		'HEADER_AUTH_EMAIL_HEADER',
		'HEADER_AUTH_DISPLAY_NAME_HEADER'
	]) {
		if (env[key] !== undefined && env[key] === SPECS.get(key)?.default) {
			updates[key] = undefined;
			changes.push({ key, action: 'removed', reason: 'same as the default' });
		}
	}
	if (env.HEADER_AUTH_DATA_DIR !== undefined && env.HEADER_AUTH_DATA_DIR === env.DATA_PATH) {
		updates.HEADER_AUTH_DATA_DIR = undefined;
		changes.push({ key: 'HEADER_AUTH_DATA_DIR', action: 'removed', reason: 'same as DATA_PATH' });
	}

	if (Object.keys(updates).length > 0) text = setEnvValues(text, updates);

	// Read back with Node's parser, the one the app boots with, so a writer bug
	// shows up here as a mismatch instead of on the server.
	const before = parseEnv(input);
	const after = parseEnv(text);
	const mismatches = [];
	for (const spec of ALL_SETTINGS) {
		const was = meaning(spec, before, { legacy: true });
		const is = meaning(spec, after, { legacy: false });
		if (JSON.stringify(was) !== JSON.stringify(is)) mismatches.push({ key: spec.key, was, is });
	}
	for (const key of Object.keys(before)) {
		if (!SPECS.has(key) && !(key in RENAMES) && after[key] !== before[key]) {
			mismatches.push({ key, was: before[key], is: after[key] });
		}
	}

	// A value both generations reject compares equal above, yet the old reader
	// shrugged it off while the new one may stop boot on it. Name those apart:
	// `blockers` stop the app, `fallbacks` run on the default.
	const report = reportFor(after);
	return {
		text,
		changes,
		mismatches,
		// A missing required key is a broken .env either way: doctor's job, not a migration's.
		blockers: report.problems.filter((p) => p.status === 'error' && p.source !== 'unset'),
		fallbacks: report.problems.filter((p) => p.status === 'invalid'),
		unknown: report.unknown
	};
}
