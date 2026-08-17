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

// Header written above the settings in a stripped .env. The pointer matters:
// without it the operator has no way back to what a var means, and the reflex
// is to paste the old annotated template back in.
export const ENV_HEADER = [
	'# Selva deployment configuration.',
	'#',
	'# Values only — every variable is documented in the runtime template at',
	'# node_modules/@selvajs/selva/templates/.env.example, which is refreshed on',
	'# every update. Do not paste that template in here: a copy stops tracking',
	'# the release and starts describing variables the code no longer reads.'
].join('\n');

/**
 * Strip a deployment `.env` down to its live settings, dropping the shipped
 * documentation block.
 *
 * A comment block copied onto a server is a snapshot with no update path —
 * `migrate` rewrites keys but never prose, so a deployment keeps documenting
 * the release it was installed at, describing vars the code has since renamed
 * or retired. Deleting it is what makes the file navigable AND unable to lie.
 *
 * Operator comments are NOT prose to be discarded: a short `#` run directly
 * above a setting (no blank line between) is that setting's note and rides
 * along with it. Everything else goes.
 *
 * "Short" is doing real work here. The shipped template also writes prose
 * immediately above a setting — its banner blocks run 40+ lines and end with a
 * bare `#` — so proximity alone would keep the very documentation this exists
 * to remove. A hand-written note is a line or two; a block longer than
 * ATTACHED_NOTE_MAX_LINES, or one containing a `# ====` banner rule, is the
 * template's and is dropped.
 *
 * Returns `{ text, removed }`, `removed` being the count of dropped comment
 * lines. `removed === 0` means the file was already values-only.
 */
export function stripEnvComments(text, { header = ENV_HEADER } = {}) {
	// Our own header is re-emitted below, so counting it as prose we removed
	// would make every run report work it didn't do — and break idempotency,
	// which is what lets doctor call a stripped file clean. Matched as a whole
	// leading block, not line-by-line: the header contains a bare `#`, and
	// excluding that by value would silently stop counting an operator's own
	// `#` separators anywhere in the file.
	let lines = text.split(/\r?\n/);
	if (header) {
		const headerLines = header.split('\n');
		const leads = headerLines.every((h, i) => lines[i]?.trim() === h.trim());
		if (leads) lines = lines.slice(headerLines.length);
	}
	const out = [];
	let pending = [];
	let removed = 0;
	let sawSetting = false;
	// Whether a blank line or dropped prose separated the last setting from the
	// next one — the original file's own grouping, worth carrying over.
	let groupBreak = false;

	const flushDropped = () => {
		const dropped = pending.filter((l) => l.trim().startsWith('#'));
		removed += dropped.length;
		// A discarded banner marked a section boundary in the original; keep that
		// boundary as a blank line so the result still reads as grouped settings.
		if (dropped.length > 0 && sawSetting) groupBreak = true;
		pending = [];
	};

	for (const line of lines) {
		const stripped = line.trim();

		if (stripped.startsWith('#')) {
			pending.push(line);
			continue;
		}

		// A blank line ends whatever comment block was accumulating: those
		// comments float free rather than annotating the next setting.
		if (!stripped) {
			if (sawSetting) groupBreak = true;
			flushDropped();
			continue;
		}

		if (stripped.indexOf('=') === -1) {
			flushDropped();
			continue;
		}

		// Comments still pending sit directly above this setting. Keep them only
		// if they read as a hand-written note rather than a template banner.
		const note = isAttachedNote(pending);
		// Blank line only where it earns one: before a kept note, or where the
		// original had a break. Separating every key would just trade a wall of
		// prose for a file twice as long as it needs to be.
		if (sawSetting && (note || groupBreak)) out.push('');
		if (note) {
			out.push(...pending);
		} else {
			flushDropped();
		}
		pending = [];
		groupBreak = false;
		out.push(line);
		sawSetting = true;
	}

	// Trailing comments annotate nothing.
	flushDropped();

	const body = out.join('\n');
	return {
		text: header ? `${header}\n\n${body}\n` : `${body}\n`,
		removed
	};
}

// A hand-written note is a line or two. Longer than this and it is the shipped
// template's prose, which is what stripping exists to remove.
const ATTACHED_NOTE_MAX_LINES = 3;

// A `# ====` rule is the template's section-banner style; nothing hand-written
// above a single setting uses it.
const BANNER_RULE = /^#\s*[=-]{4,}/;

function isAttachedNote(pending) {
	if (pending.length === 0 || pending.length > ATTACHED_NOTE_MAX_LINES) return false;
	return !pending.some((l) => BANNER_RULE.test(l.trim()));
}

/**
 * How many lines of the file are shipped documentation rather than config.
 * Used by `selva doctor` to flag an annotated `.env` without rewriting it.
 */
export function countEnvCommentLines(text) {
	const { removed } = stripEnvComments(text);
	return removed;
}

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

/**
 * Render a values-only `.env` — the scaffold's default shape.
 *
 * The annotated template is genuinely useful while you are deciding what to
 * set, which is why the runtime still ships it; it stops being useful the
 * moment it is written to a server and cannot be corrected there. So the
 * template stays a reference and the deployment gets values, in the template's
 * own key order (it groups related settings) with anything unknown appended.
 */
export function renderEnvValues(template, values, { header = ENV_HEADER } = {}) {
	const ordered = [];
	const seen = new Set();

	// The template names a var three ways — live (`KEY=v`), commented-out
	// (`# KEY=v`), and as a bare mention in prose (`# KEY   single | multi`).
	// All three signal where the var belongs, so the first token of any line is
	// enough; anything that isn't a known key is filtered out below.
	for (const rawLine of template.split(/\r?\n/)) {
		const stripped = rawLine.trim().replace(/^#\s*/, '');
		const key = stripped.split(/[\s=]/)[0]?.trim();
		if (!key || !/^[A-Z][A-Z0-9_]{2,}$/.test(key)) continue;
		if (seen.has(key)) continue;
		if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
		seen.add(key);
		ordered.push(key);
	}

	for (const key of Object.keys(values)) {
		if (!seen.has(key)) ordered.push(key);
	}

	const lines = [];
	for (const key of ordered) {
		const value = values[key];
		if (value === undefined || value === null || value === '') continue;
		lines.push(`${key}=${quoteIfNeeded(value)}`);
	}

	return header ? `${header}\n\n${lines.join('\n')}\n` : `${lines.join('\n')}\n`;
}

/** Writes the deployment `.env` — values only, in the template's key order. */
export function writeEnvFile(path, template, values) {
	writeFileSync(path, renderEnvValues(template, values), 'utf8');
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
