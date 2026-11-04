import { describe, expect, it } from 'vitest';
import {
	buildConfigReport,
	composeManifest,
	defineSetting,
	diffSnapshots,
	takeSnapshot
} from '../index.js';

const manifest = composeManifest([
	defineSetting({
		key: 'SELVA_HMAC_KEY',
		type: 'string',
		minLength: 32,
		required: true,
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		generated: true,
		summary: true,
		description: 'Signing key.'
	}),
	defineSetting({
		key: 'SMTP_PASS',
		type: 'string',
		onInvalid: 'fail',
		class: 'secret',
		sensitive: true,
		description: 'SMTP password.'
	}),
	defineSetting({
		key: 'ORIGIN',
		type: 'url',
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Public URL.'
	}),
	defineSetting({
		key: 'COMPUTE_SOLVE_CACHE_MB',
		type: 'int',
		min: 0,
		default: 256,
		onInvalid: 'default',
		class: 'tunable',
		description: 'Cache.'
	})
]);

const HMAC = 'secret-signing-key-'.repeat(4);
const PASS = 'hunter2-smtp-password';

describe('buildConfigReport', () => {
	const report = buildConfigReport(
		manifest,
		{
			SELVA_HMAC_KEY: HMAC,
			SMTP_PASS: PASS,
			ORIGIN: 'https://selva.example.com',
			COMPUTE_SOLVE_CACHE_MB: 'lots',
			SELVA_HMAC_KY: 'typo'
		},
		{ prefixes: ['SELVA_'] }
	);

	it('never puts a secret value in the report', () => {
		const text = JSON.stringify(report);
		expect(text).not.toContain(HMAC);
		expect(text).not.toContain(PASS);
		// The typo'd key is unknown, so its value may be anything: not echoed either.
		expect(text).not.toContain('typo');
	});

	it('fingerprints generated keys and only says "set" for other secrets', () => {
		const row = (k: string) => report.rows.find((r) => r.key === k)!;
		expect(row('SELVA_HMAC_KEY').display).toMatch(/^sha256:[0-9a-f]{8}$/);
		expect(row('SMTP_PASS').display).toBe('set');
		expect(row('ORIGIN').display).toBe('https://selva.example.com');
	});

	it('a default shows its value and is marked as a default', () => {
		const defaulted = buildConfigReport(manifest, { SELVA_HMAC_KEY: HMAC }).rows.find(
			(r) => r.key === 'COMPUTE_SOLVE_CACHE_MB'
		)!;
		expect(defaulted).toMatchObject({ display: '256', source: 'default' });
	});

	it('lists problems: invalid values and unknown keys', () => {
		expect(report.problems.map((r) => [r.key, r.status])).toEqual([
			['COMPUTE_SOLVE_CACHE_MB', 'invalid']
		]);
		expect(report.unknown).toEqual([{ key: 'SELVA_HMAC_KY', suggestion: 'SELVA_HMAC_KEY' }]);
	});

	it('summary rows come first, in manifest order', () => {
		expect(report.rows.filter((r) => r.summary).map((r) => r.key)).toEqual([
			'SELVA_HMAC_KEY',
			'ORIGIN'
		]);
	});

	it('the same key gives the same fingerprint, a different key a different one', () => {
		const a = buildConfigReport(manifest, { SELVA_HMAC_KEY: HMAC }).rows[0].display;
		const b = buildConfigReport(manifest, { SELVA_HMAC_KEY: HMAC }).rows[0].display;
		const c = buildConfigReport(manifest, { SELVA_HMAC_KEY: HMAC + 'x' }).rows[0].display;
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
});

describe('config snapshots', () => {
	const env = { SELVA_HMAC_KEY: HMAC, SMTP_PASS: PASS, ORIGIN: 'https://a.example.com' };

	it('holds no secret value', () => {
		const snap = takeSnapshot(manifest, env, 'salt-1');
		const text = JSON.stringify(snap);
		expect(text).not.toContain(HMAC);
		expect(text).not.toContain(PASS);
		expect(snap.values.ORIGIN).toBe('https://a.example.com');
	});

	it('diffs show old and new for plain keys, and only "changed" for secrets', () => {
		const before = takeSnapshot(manifest, env, 'salt-1');
		const after = takeSnapshot(
			manifest,
			{ ...env, SMTP_PASS: 'other', ORIGIN: 'https://b.example.com', COMPUTE_SOLVE_CACHE_MB: '64' },
			before.salt
		);
		expect(diffSnapshots(before, after)).toEqual([
			{ key: 'SMTP_PASS', change: 'changed' },
			{
				key: 'ORIGIN',
				change: 'changed',
				from: 'https://a.example.com',
				to: 'https://b.example.com'
			},
			{ key: 'COMPUTE_SOLVE_CACHE_MB', change: 'added', to: '64' }
		]);
	});

	it('an unchanged env diffs empty', () => {
		const a = takeSnapshot(manifest, env, 's');
		expect(diffSnapshots(a, takeSnapshot(manifest, env, a.salt))).toEqual([]);
	});
});
