// Stripping rewrites the operator's .env in place, so these pin the blast
// radius: no live setting may change, and a comment the operator wrote next to
// a setting is theirs, not ours to delete.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	stripEnvComments,
	countEnvCommentLines,
	renderEnvValues,
	parseEnv,
	ENV_HEADER
} from '../env.js';
import { checkEnvDocumentation } from '../checks/config.js';

test('drops the shipped documentation block and keeps every setting', () => {
	const before = [
		'# ============================================================',
		'# COMPUTE-APP ENVIRONMENT VARIABLES',
		'# ============================================================',
		'# Long prose that describes the release this was installed at.',
		'',
		'DATA_PATH=./.selva-data',
		'ORIGIN=https://vektornode.dev',
		''
	].join('\n');

	const { text, removed } = stripEnvComments(before);

	assert.equal(removed, 4);
	assert.deepEqual(parseEnv(text), {
		DATA_PATH: './.selva-data',
		ORIGIN: 'https://vektornode.dev'
	});
	assert.ok(text.startsWith(ENV_HEADER));
});

test('keeps an operator note attached to the setting below it', () => {
	// A `#` line directly above a setting is that setting's annotation. Deleting
	// it would throw away the one piece of documentation nothing else records.
	const before = ['# bumped for the 200MB site model upload', 'BODY_SIZE_LIMIT=210M', ''].join(
		'\n'
	);

	const { text, removed } = stripEnvComments(before);

	assert.equal(removed, 0);
	assert.match(text, /# bumped for the 200MB site model upload\nBODY_SIZE_LIMIT=210M/);
});

test('a banner block directly above a setting is the template, not a note', () => {
	// The shipped template writes prose right up against its settings with no
	// blank line, so proximity alone would preserve the very documentation this
	// exists to remove. The `# ====` rule is the tell.
	const before = [
		'# ============================================================',
		'# OPTIONAL: Request Body Size Limit',
		'# ============================================================',
		'# Global cap enforced by adapter-node for every route.',
		'#',
		'BODY_SIZE_LIMIT=210M',
		''
	].join('\n');

	const { text, removed } = stripEnvComments(before);

	assert.equal(removed, 5);
	assert.doesNotMatch(text, /adapter-node/);
	assert.equal(parseEnv(text).BODY_SIZE_LIMIT, '210M');
});

test('a long unbannered block above a setting is still template prose', () => {
	const before = [
		...Array.from({ length: 8 }, (_, i) => `# explanation line ${i}`),
		'ORIGIN=https://example.com',
		''
	].join('\n');

	const { text, removed } = stripEnvComments(before);

	assert.equal(removed, 8);
	assert.doesNotMatch(text, /explanation/);
	assert.equal(parseEnv(text).ORIGIN, 'https://example.com');
});

test('a blank line severs a comment from the setting below it', () => {
	// Free-floating prose is the shipped template's shape; an attached note is
	// the operator's. The blank line is the only signal separating the two.
	const before = ['# shipped prose about body limits', '', 'BODY_SIZE_LIMIT=210M', ''].join('\n');

	const { text, removed } = stripEnvComments(before);

	assert.equal(removed, 1);
	assert.doesNotMatch(text, /shipped prose/);
	assert.equal(parseEnv(text).BODY_SIZE_LIMIT, '210M');
});

test('drops commented-out settings — they are documentation, not config', () => {
	// These are the stale ones: `# MAX_SOLVE_DURATION_MS=…` describes a var the
	// code stopped reading, and keeping it is what makes the file lie.
	const before = ['# MAX_SOLVE_DURATION_MS=100000', '', 'ORIGIN=https://example.com', ''].join(
		'\n'
	);

	const { text } = stripEnvComments(before);

	assert.doesNotMatch(text, /MAX_SOLVE_DURATION_MS/);
	assert.deepEqual(parseEnv(text), { ORIGIN: 'https://example.com' });
});

test('preserves values verbatim, including quotes', () => {
	const { text } = stripEnvComments('DATA_PATH="../../.selva-data"\nSELVA_TENANCY=single\n');
	assert.match(text, /^DATA_PATH="\.\.\/\.\.\/\.selva-data"$/m);
	assert.equal(parseEnv(text).DATA_PATH, '../../.selva-data');
});

test('is idempotent — stripping an already-stripped file changes nothing', () => {
	const once = stripEnvComments('# prose\n\nORIGIN=https://example.com\n').text;
	const twice = stripEnvComments(once);
	assert.equal(twice.removed, 0);
	assert.equal(twice.text, once);
});

test('a trailing comment block annotates nothing and is dropped', () => {
	const { text, removed } = stripEnvComments('ORIGIN=https://example.com\n\n# leftover notes\n');
	assert.equal(removed, 1);
	assert.doesNotMatch(text, /leftover/);
});

// ── renderEnvValues (scaffold shape) ────────────────────────────────────

test('scaffold writes values only, in the template key order', () => {
	const template = [
		'# docs about tenancy',
		'# SELVA_TENANCY             single | multi',
		'',
		'DATA_PATH=./.selva-data',
		'# ORIGIN=https://your-domain.com'
	].join('\n');

	const text = renderEnvValues(template, {
		ORIGIN: 'https://example.com',
		SELVA_TENANCY: 'single',
		DATA_PATH: './data'
	});

	// Template order (tenancy, DATA_PATH, ORIGIN) — the template groups related
	// settings, so following it keeps the stripped file readable.
	assert.deepEqual(
		text
			.split('\n')
			.filter((l) => l.includes('=') && !l.startsWith('#'))
			.map((l) => l.split('=')[0]),
		['SELVA_TENANCY', 'DATA_PATH', 'ORIGIN']
	);
	assert.doesNotMatch(text, /docs about tenancy/);
});

test('scaffold omits empty values rather than writing bare keys', () => {
	// collectConfig returns '' for unset flags; a bare `SELVA_FLAG_X=` line reads
	// as configured-and-off when it means never-set.
	const text = renderEnvValues('', { ORIGIN: '', SELVA_FLAG_ENABLE_SHARING: 'true' });
	assert.doesNotMatch(text, /ORIGIN/);
	assert.match(text, /SELVA_FLAG_ENABLE_SHARING=true/);
});

test('scaffold appends values the template never mentions', () => {
	const text = renderEnvValues('DATA_PATH=x\n', { DATA_PATH: 'y', CUSTOM_THING: 'z' });
	assert.equal(parseEnv(text).CUSTOM_THING, 'z');
});

// ── doctor check ────────────────────────────────────────────────────────

test('doctor stays quiet about a values-only .env', () => {
	assert.equal(checkEnvDocumentation(0).severity, 'green');
	assert.equal(checkEnvDocumentation(12).severity, 'green');
});

test('doctor flags a .env still carrying the shipped documentation', () => {
	const result = checkEnvDocumentation(470);
	assert.equal(result.severity, 'yellow');
	assert.match(result.line, /470/);
	assert.match(result.line, /npx selva doctor --fix/);
});

test('the real 4.6-era template is over the budget and strips cleanly', () => {
	// The case this whole feature exists for: a deployment installed at 4.6 keeps
	// 4.6's prose forever, describing vars the code has since renamed.
	const legacy = [
		'# ============================================================',
		'# Compute limits',
		'# ============================================================',
		'# Maximum solve duration, forwarded to the browser.',
		'# MAX_SOLVE_DURATION_MS=60000',
		'#',
		'# Upload caps.',
		'# MAX_GH_FILE_SIZE_BYTES=52428800',
		'# DEFINITION_CACHE_TTL_MS=300000',
		...Array.from({ length: 40 }, (_, i) => `# filler documentation line ${i}`),
		'',
		'BODY_SIZE_LIMIT=150M',
		'ORIGIN=https://vektornode.dev',
		''
	].join('\n');

	assert.equal(checkEnvDocumentation(countEnvCommentLines(legacy)).severity, 'yellow');

	const { text } = stripEnvComments(legacy);
	assert.deepEqual(parseEnv(text), {
		BODY_SIZE_LIMIT: '150M',
		ORIGIN: 'https://vektornode.dev'
	});
});

// A scaffolded deployment used to omit BODY_SIZE_LIMIT entirely, because the
// template was read for key ORDER only. Unset, adapter-node falls back to
// 512 KB and every upload 413s with an opaque non-JSON body.
test('seeds BODY_SIZE_LIMIT from the template when the prompts do not set it', () => {
	const template = [
		'# Global body cap.',
		'BODY_SIZE_LIMIT=256M',
		'ORIGIN=https://example.dev'
	].join('\n');

	const rendered = renderEnvValues(template, { ORIGIN: 'https://selvajs.com' });
	assert.equal(parseEnv(rendered).BODY_SIZE_LIMIT, '256M');
	assert.equal(parseEnv(rendered).ORIGIN, 'https://selvajs.com');
});

test('an operator value beats the template default', () => {
	const template = 'BODY_SIZE_LIMIT=256M';
	const rendered = renderEnvValues(template, { BODY_SIZE_LIMIT: '512M' });
	assert.equal(parseEnv(rendered).BODY_SIZE_LIMIT, '512M');
});

// Seeding is an allowlist, not "every live line in the template": the template
// also ships a placeholder key and a monorepo-relative DATA_PATH.
test('never seeds the scaffold placeholder secrets or DATA_PATH', () => {
	const template = [
		'SELVA_HMAC_KEY=replace-this-with-a-random-32-byte-hex-key',
		'SELVA_AT_REST_KEY=replace-this-with-a-random-32-byte-hex-key',
		'DATA_PATH="../../.selva-data"',
		'BODY_SIZE_LIMIT=256M'
	].join('\n');

	const parsed = parseEnv(renderEnvValues(template, {}));
	assert.deepEqual(parsed, { BODY_SIZE_LIMIT: '256M' });
});
