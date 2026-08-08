// Minimal .env parser/serializer (no dotenv; runtime uses node --env-file).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Old env name → its replacement, for keys renamed without changing meaning.
// The server still reads each old name for one minor version and warns at
// boot; keep this in sync with the server's list and drop an entry once the
// server stops reading it.
export const RENAMED_ENV_VARS = {
	COMPUTE_DEFINITION_BYTE_CACHE_MB: 'COMPUTE_DEFINITION_CACHE_MB',
	COMPUTE_RESPONSE_CACHE_MB: 'COMPUTE_SOLVE_CACHE_MB',
	DEFINITION_CACHE_TTL_MS: 'REMOTE_DEFINITION_CACHE_TTL_MS',
	MAX_SOLVE_DURATION_MS: 'COMPUTE_SOLVE_DEADLINE_MS'
};

// Deprecated vars whose replacement changes the VALUE too, so a simple key
// rename can't migrate them — `selva migrate` leaves these alone rather than guessing.
export const REPLACED_ENV_VARS = {
	SELVA_FLAG_COMPUTE_DEBUG_VERBOSE: 'SELVA_FLAG_COMPUTE_DEBUG=verbose'
};

export function parseEnv(text) {
	const out = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

export function readEnvFile(path) {
	if (!existsSync(path)) return {};
	return parseEnv(readFileSync(path, 'utf8'));
}

export function mergeEnv(template, values) {
	const seen = new Set();
	const lines = template.split(/\r?\n/);
	const out = [];

	for (const line of lines) {
		const stripped = line.trim();
		if (!stripped || stripped.startsWith('#')) {
			out.push(line);
			continue;
		}
		const eq = stripped.indexOf('=');
		if (eq === -1) {
			out.push(line);
			continue;
		}
		const key = stripped.slice(0, eq).trim();
		if (Object.prototype.hasOwnProperty.call(values, key)) {
			out.push(`${key}=${quoteIfNeeded(values[key])}`);
			seen.add(key);
		} else {
			out.push(line);
		}
	}

	const appended = [];
	for (const [key, value] of Object.entries(values)) {
		if (seen.has(key)) continue;
		if (value === undefined || value === null || value === '') continue;
		appended.push(`${key}=${quoteIfNeeded(value)}`);
	}

	if (appended.length > 0) {
		if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
		out.push('# ============================================================================');
		out.push('# Additional values written by the Selva CLI');
		out.push('# ============================================================================');
		out.push(...appended);
	}

	while (out.length > 0 && out[out.length - 1] === '') out.pop();
	return out.join('\n') + '\n';
}

export function writeEnvFile(path, template, values) {
	writeFileSync(path, mergeEnv(template, values), 'utf8');
}

/**
 * Rewrite deprecated keys to their current names, in place. Only the key is
 * touched — value, comments, ordering, and spacing survive.
 *
 * A key already present under its new name is left alone and its old line is
 * dropped: the server resolves new-name-wins, so keeping both would preserve
 * a line that does nothing.
 *
 * Returns `{ text, changes }`, `changes` being `[oldName, newName, 'renamed'
 * | 'dropped']` per line acted on. Empty means the file was already current.
 */
export function renameEnvKeys(text, renames) {
	const present = new Set(Object.keys(parseEnv(text)));
	const changes = [];
	const out = [];

	for (const line of text.split(/\r?\n/)) {
		const stripped = line.trim();
		const eq = stripped.indexOf('=');
		if (!stripped || stripped.startsWith('#') || eq === -1) {
			out.push(line);
			continue;
		}
		const key = stripped.slice(0, eq).trim();
		const newName = renames[key];
		if (!newName) {
			out.push(line);
			continue;
		}
		if (present.has(newName)) {
			changes.push([key, newName, 'dropped']);
			continue;
		}
		out.push(line.replace(key, newName));
		changes.push([key, newName, 'renamed']);
	}

	return { text: out.join('\n'), changes };
}

function quoteIfNeeded(value) {
	const s = String(value);
	if (s === '') return '""';
	if (/[\s"'#=]/.test(s)) return JSON.stringify(s);
	return s;
}
