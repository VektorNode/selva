// .env reading and writing. Reads go through Node's own parser, the one
// `node --env-file` boots the app with, so the CLI never sees a value the app
// doesn't.

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { parseEnv as nodeParseEnv } from 'node:util';
import { ALL_SETTINGS } from './generated/config.js';

// Old env name → its replacement, for keys renamed without changing meaning.
// From the manifest's `aliases`, the same list the server reads old names by.
export const RENAMED_ENV_VARS = Object.fromEntries(
	ALL_SETTINGS.flatMap((s) => (s.aliases ?? []).map((alias) => [alias, s.key]))
);

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
	return nodeParseEnv(text);
}

export function readEnvFile(path) {
	if (!existsSync(path)) return {};
	return parseEnv(readFileSync(path, 'utf8'));
}

/**
 * Template vars whose shipped value is a real default a deployment should run
 * with, rather than a placeholder or a prompt answer.
 *
 * Deliberately an allowlist, not "every live line in the template". The template
 * also ships `SELVA_HMAC_KEY=replace-this-…` (seeding it would give every
 * deployment a publicly known key) and a monorepo-relative `DATA_PATH` that is
 * wrong anywhere but this repo.
 *
 * `BODY_SIZE_LIMIT` has to be here: unset, adapter-node falls back to 512 KB and
 * every upload 413s with an opaque non-JSON body, which reads as a broken
 * install rather than a missing setting.
 */
const SEEDED_TEMPLATE_DEFAULTS = ['BODY_SIZE_LIMIT'];

/** The subset of the template's live `KEY=value` lines that are safe to seed. */
export function seededTemplateDefaults(template) {
	const parsed = parseEnv(template);
	const out = {};
	for (const key of SEEDED_TEMPLATE_DEFAULTS) {
		if (parsed[key] !== undefined) out[key] = parsed[key];
	}
	return out;
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
	const defaults = seededTemplateDefaults(template);

	// The template names a var three ways — live (`KEY=v`), commented-out
	// (`# KEY=v`), and as a bare mention in prose (`# KEY   single | multi`).
	// All three signal where the var belongs, so the first token of any line is
	// enough; anything that isn't a known key is filtered out below.
	for (const rawLine of template.split(/\r?\n/)) {
		const stripped = rawLine.trim().replace(/^#\s*/, '');
		const key = stripped.split(/[\s=]/)[0]?.trim();
		if (!key || !/^[A-Z][A-Z0-9_]{2,}$/.test(key)) continue;
		if (seen.has(key)) continue;
		// A live `KEY=value` in the template is a shipped default, not just an
		// ordering hint: the prompts cover a fraction of the vars, so without this
		// a scaffolded deployment silently runs on the code's fallback instead.
		// BODY_SIZE_LIMIT is the case that bites — adapter-node's fallback is
		// 512 KB, so every upload 413s until an operator sets it by hand.
		if (
			!Object.prototype.hasOwnProperty.call(values, key) &&
			!Object.prototype.hasOwnProperty.call(defaults, key)
		) {
			continue;
		}
		seen.add(key);
		ordered.push(key);
	}

	for (const key of Object.keys(values)) {
		if (!seen.has(key)) ordered.push(key);
	}

	const lines = [];
	for (const key of ordered) {
		// Operator values win over the template's defaults, including when the
		// operator has deliberately blanked one out.
		const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaults[key];
		if (value === undefined || value === null || value === '') continue;
		lines.push(`${key}=${encodeEnvValue(value)}`);
	}

	return header ? `${header}\n\n${lines.join('\n')}\n` : `${lines.join('\n')}\n`;
}

/** Writes a fresh deployment `.env`, values only, in the template's key order. */
export function writeEnvFile(path, template, values) {
	writeEnvText(path, renderEnvValues(template, values));
}

/** `.env` holds both root keys, so it is the owner's alone. */
export function writeEnvText(path, text) {
	writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 });
	// `mode` applies only when the file is created; an existing file keeps its own.
	if (process.platform !== 'win32') chmodSync(path, 0o600);
}

/**
 * Set or remove keys in an existing `.env`, touching only their lines.
 *
 * Re-rendering the whole file drops the operator's comments and re-encodes
 * every value. `undefined` or `null` removes the key; a key not yet present is
 * appended.
 */
export function setEnvValues(text, updates) {
	const pending = new Map(Object.entries(updates));
	const lines = text.split(/\r?\n/);
	// Node reads the last line for a key that appears twice, so that is the one
	// to edit; earlier duplicates would only mislead the next reader of the file.
	const last = new Map();
	lines.forEach((line, i) => {
		const key = keyOfLine(line);
		if (key !== null && pending.has(key)) last.set(key, i);
	});
	const out = [];
	lines.forEach((line, i) => {
		const key = keyOfLine(line);
		if (key === null || !pending.has(key)) {
			out.push(line);
			return;
		}
		if (last.get(key) !== i) return;
		const value = pending.get(key);
		if (value !== undefined && value !== null) out.push(`${key}=${encodeEnvValue(value)}`);
	});
	for (const key of last.keys()) pending.delete(key);
	// The split leaves '' for the final newline; appended keys go above it.
	while (out.length > 0 && out[out.length - 1] === '') out.pop();
	for (const [key, value] of pending) {
		if (value === undefined || value === null) continue;
		out.push(`${key}=${encodeEnvValue(value)}`);
	}
	return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

function keyOfLine(line) {
	const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
	return match ? match[1] : null;
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

/**
 * Quote a value so Node's parser reads it back unchanged. Node does not
 * unescape `\"` inside double quotes, so `JSON.stringify` corrupts JSON values,
 * and an unquoted `#` starts a comment. Single quotes are literal, so they come
 * first; the other two quote kinds cover values that contain them.
 */
export function encodeEnvValue(value) {
	const s = String(value);
	if (s === '') return "''";
	if (!/[\s"'`#\\]/.test(s)) return s;
	if (s.includes('\n')) throw new Error('Multi-line .env values are not supported');
	for (const q of ["'", '"', '`']) if (!s.includes(q)) return `${q}${s}${q}`;
	throw new Error('Value contains every quote character and cannot be written to .env');
}
