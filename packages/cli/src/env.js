// Minimal .env parser / serializer.
//
// We don't pull in dotenv: the runtime already loads .env via node --env-file,
// and the CLI's needs are simpler than dotenv supports (no shell expansion, no
// multiline values). Keeping it in-tree means one less dep to vet.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Parse a .env file into { key: value }. Preserves nothing else.
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

// Re-serialize a .env file. Comments + section structure from `template` are
// preserved; lines whose key appears in `values` get rewritten in-place. Keys
// in `values` but absent from the template are appended at the end.
//
// Lines beginning with `# KEY=...` (commented examples) are treated as
// suggestions and left alone; the actual value (if any) goes uncommented.
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

	return out.join('\n');
}

export function writeEnvFile(path, template, values) {
	writeFileSync(path, mergeEnv(template, values), 'utf8');
}

function quoteIfNeeded(value) {
	const s = String(value);
	if (s === '') return '""';
	if (/[\s"'#=]/.test(s)) return JSON.stringify(s);
	return s;
}
