import { describe, expect, it } from 'vitest';
import type { EnvRecord } from '@selvajs/platform/config';
import { configChecks, parseBodySize, requestFacts, type CheckInput } from '../checks.js';
import { ALL_SETTINGS, deploymentReport } from '../settings.js';

const KEY = 'ab'.repeat(32);
const BASE: EnvRecord = {
	NODE_ENV: 'production',
	SELVA_HMAC_KEY: KEY,
	SELVA_AT_REST_KEY: KEY,
	DATA_PATH: '/srv/selva-data',
	BODY_SIZE_LIMIT: '256M'
};
const DIRECT = { proxied: false, seenOrigin: 'http://10.0.0.5:3000' };
const PROXIED = { proxied: true, seenOrigin: 'https://selva.example.com' };

function run(env: EnvRecord, over: Partial<CheckInput> = {}) {
	return configChecks({
		env,
		report: deploymentReport(env),
		rotation: [],
		atRestOnPreviousKey: null,
		request: DIRECT,
		computeRequestMaxBytes: 256 * 1024 * 1024,
		dev: false,
		...over
	});
}
const ids = (env: EnvRecord, over: Partial<CheckInput> = {}) => run(env, over).map((c) => c.id);

describe('configChecks', () => {
	it('finds nothing on a correct deployment behind a proxy', () => {
		const env = {
			...BASE,
			ORIGIN: 'https://selva.example.com',
			HOST: '127.0.0.1',
			ADDRESS_HEADER: 'X-Forwarded-For',
			XFF_DEPTH: '1'
		};
		expect(run(env, { request: PROXIED })).toEqual([]);
	});

	it('behind a proxy without ORIGIN, suggests the address the admin actually used', () => {
		const c = run(
			{ ...BASE, HOST: '127.0.0.1', ADDRESS_HEADER: 'X-Forwarded-For' },
			{ request: PROXIED }
		);
		expect(c[0]).toMatchObject({ id: 'origin-missing', level: 'error' });
		expect(c[0].fix?.[0]).toBe('npx selva config set ORIGIN=https://selva.example.com');
	});

	it('flags the proxy hazards only when a proxy is in front', () => {
		expect(ids(BASE)).not.toContain('address-header');
		expect(ids(BASE, { request: PROXIED })).toEqual(
			expect.arrayContaining(['address-header', 'host-open'])
		);
	});

	it('an open HOST under header auth is an error, not a warning', () => {
		const c = run({ ...BASE, SELVA_AUTH_PROVIDER: 'header' }, { request: PROXIED });
		expect(c.find((x) => x.id === 'host-open')?.level).toBe('error');
	});

	it('warns when BODY_SIZE_LIMIT is below what a solve may send', () => {
		expect(ids({ ...BASE, BODY_SIZE_LIMIT: '512K' })).toContain('body-size');
		expect(ids(BASE)).not.toContain('body-size');
	});

	it('development mode is a finding only outside vite dev', () => {
		expect(ids({ ...BASE, NODE_ENV: 'development' })).toContain('not-production');
		expect(ids({ ...BASE, NODE_ENV: 'development' }, { dev: true })).not.toContain(
			'not-production'
		);
	});

	it('names a typo and the key it meant', () => {
		const c = run({ ...BASE, SELVA_HMAC_KY: 'x' });
		expect(c.find((x) => x.id === 'unknown:SELVA_HMAC_KY')?.detail).toContain('SELVA_HMAC_KEY');
	});

	it('withholds "finish" while stored API keys are still on the old encryption key', () => {
		const c = run(BASE, {
			rotation: [{ key: 'SELVA_AT_REST_KEY', state: 'no-deadline' }],
			atRestOnPreviousKey: 2
		});
		expect(c.find((x) => x.id === 'rotation:SELVA_AT_REST_KEY')?.fix).toBeUndefined();
		expect(c.find((x) => x.id === 'at-rest-pending')?.level).toBe('warning');
	});

	it('sorts errors before warnings before notes', () => {
		const levels = run(
			{ ...BASE, BODY_SIZE_LIMIT: '1K', SELVA_FLAG_COMPUTE_DEBUG: 'verbose' },
			{
				request: PROXIED,
				rotation: [{ key: 'SELVA_HMAC_KEY', state: 'active', daysLeft: 3, expires: '2030-01-01' }]
			}
		).map((c) => c.level);
		expect(levels).toEqual(
			[...levels].sort(
				(a, b) => ['error', 'warning', 'info'].indexOf(a) - ['error', 'warning', 'info'].indexOf(b)
			)
		);
	});
});

describe('requestFacts', () => {
	it('reads what the visitor typed from the proxy headers', () => {
		const h = new Headers({
			'x-forwarded-proto': 'https',
			'x-forwarded-host': 'selva.example.com, inner'
		});
		expect(requestFacts(h, new URL('http://127.0.0.1:3000/admin'))).toEqual(PROXIED);
	});

	it('a bare request is direct', () => {
		expect(requestFacts(new Headers(), new URL('http://10.0.0.5:3000/admin'))).toEqual(DIRECT);
	});
});

describe('parseBodySize', () => {
	it.each([
		['512K', 512 * 1024],
		['256M', 256 * 1024 ** 2],
		['1G', 1024 ** 3],
		['1000', 1000],
		['Infinity', Infinity],
		['lots', null]
	])('%s', (raw, bytes) => expect(parseBodySize(raw)).toBe(bytes));
});

it('every setting has a plain label for the admin page', () => {
	expect(ALL_SETTINGS.filter((s) => !s.label).map((s) => s.key)).toEqual([]);
});
