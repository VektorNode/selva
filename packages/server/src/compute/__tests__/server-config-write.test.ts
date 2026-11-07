/**
 * The apiKey merge is shared by the platform and org compute-config writes. A
 * divergence between those two paths silently clears or leaks a stored
 * credential and nothing fails at build time — hence the coverage here rather
 * than through either route.
 */

import { describe, it, expect } from 'vitest';
import {
	resolveApiKey,
	storedKeysById,
	assertStoredKeysReadable,
	assertKeyNotRetargeted,
	validateIncomingServers,
	type IncomingServerBase
} from '../server-config-write.js';

const server = (over: Partial<IncomingServerBase> = {}): IncomingServerBase => ({
	id: '11111111-1111-4111-8111-111111111111',
	label: 'Compute A',
	serverUrl: 'https://compute.example.test',
	...over
});

describe('resolveApiKey', () => {
	it('preserves the stored key when the field is omitted', () => {
		expect(resolveApiKey(undefined, 'stored-key')).toBe('stored-key');
	});

	it('treats an empty string as untouched — an unedited password input submits ""', () => {
		expect(resolveApiKey('', 'stored-key')).toBe('stored-key');
	});

	it('clears the key only on an explicit null', () => {
		expect(resolveApiKey(null, 'stored-key')).toBeUndefined();
	});

	it('replaces the key with a non-empty submitted value', () => {
		expect(resolveApiKey('new-key', 'stored-key')).toBe('new-key');
	});

	it('stays undefined when there is nothing stored and nothing submitted', () => {
		expect(resolveApiKey(undefined, undefined)).toBeUndefined();
		expect(resolveApiKey('', undefined)).toBeUndefined();
	});

	it('accepts a new key for a server that had none', () => {
		expect(resolveApiKey('first-key', undefined)).toBe('first-key');
	});
});

describe('storedKeysById', () => {
	it('maps ids to keys and reports undefined for unknown ids', () => {
		const keys = storedKeysById([{ id: 'a', apiKey: 'key-a' }, { id: 'b' }]);
		expect(keys.get('a')).toBe('key-a');
		expect(keys.get('b')).toBeUndefined();
		// An id absent from the scope resolves to undefined, so a write in one
		// scope can never inherit a key from another's rows.
		expect(keys.get('c')).toBeUndefined();
	});
});

describe('validateIncomingServers', () => {
	it('accepts a well-formed set', () => {
		expect(() =>
			validateIncomingServers([server(), server({ id: '22222222-2222-4222-8222-222222222222' })])
		).not.toThrow();
	});

	it.each([
		['missing id', server({ id: '' })],
		['missing label', server({ label: '' })],
		['missing serverUrl', server({ serverUrl: '' })],
		['unparseable serverUrl', server({ serverUrl: 'not-a-url' })]
	])('rejects %s', (_case, bad) => {
		expect(() => validateIncomingServers([bad])).toThrow();
	});

	it('rejects a non-string, non-null apiKey', () => {
		expect(() => validateIncomingServers([server({ apiKey: 42 as unknown as string })])).toThrow();
	});

	it('allows apiKey to be omitted or explicitly null', () => {
		expect(() => validateIncomingServers([server({ apiKey: null })])).not.toThrow();
		expect(() => validateIncomingServers([server()])).not.toThrow();
	});
});

/**
 * The stored `serverUrl` is fetched server-side on every status probe and every
 * solve, so validation here is the SSRF gate — see SEL-3.
 *
 * The guard is narrowed to link-local on purpose. Loopback and RFC1918 are how
 * most deployments actually reach their compute server, so blocking them would
 * break those instances and push everyone onto an opt-out flag — and a guard
 * everyone disables protects nobody. `169.254.0.0/16` is the one range where no
 * legitimate compute server lives and where the damage is credential theft.
 */
describe('validateIncomingServers — SSRF guard on serverUrl', () => {
	it.each([
		['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
		['metadata as an integer literal', 'http://2852039166/'],
		['metadata as a hex literal', 'http://0xa9fea9fe/'],
		['anywhere else in link-local', 'http://169.254.1.1/'],
		['IPv6 link-local', 'http://[fe80::1]/']
	])('rejects %s', (_case, serverUrl) => {
		expect(() => validateIncomingServers([server({ serverUrl })])).toThrow();
	});

	it.each([
		['file', 'file:///etc/passwd'],
		['gopher', 'gopher://compute.example.test/'],
		['javascript', 'javascript:alert(1)']
	])('rejects the %s scheme', (_case, serverUrl) => {
		expect(() => validateIncomingServers([server({ serverUrl })])).toThrow();
	});

	// The ordinary self-hosted layouts. If any of these ever starts throwing,
	// upgrading Selva breaks real deployments at their next compute-config save.
	it.each([
		['loopback', 'http://127.0.0.1:6500'],
		['loopback by name', 'http://localhost:6500'],
		['RFC1918 class A', 'http://10.0.0.5:6500'],
		['RFC1918 class B (docker)', 'http://172.20.1.50:6500'],
		['RFC1918 class C', 'http://192.168.1.42:6500'],
		['IPv6 loopback', 'http://[::1]:6500'],
		['public https', 'https://compute.example.test']
	])('allows %s', (_case, serverUrl) => {
		expect(() => validateIncomingServers([server({ serverUrl })])).not.toThrow();
	});
});

describe('validateIncomingServers apiKey', () => {
	const server = {
		id: '11111111-1111-4111-8111-111111111111',
		label: 'x',
		serverUrl: 'http://compute.example'
	};

	it('refuses ciphertext, which a client has no business sending back', () => {
		for (const apiKey of ['enc:v1:abc', 'enc:v2:abc']) {
			expect(() => validateIncomingServers([{ ...server, apiKey }])).toThrow(/apiKey/);
		}
	});

	it('accepts a plain key, null and omitted', () => {
		for (const apiKey of ['plain', null, undefined]) {
			expect(() => validateIncomingServers([{ ...server, apiKey }])).not.toThrow();
		}
	});
});

describe('validateIncomingServers shape', () => {
	const id = '11111111-1111-4111-8111-111111111111';
	const server = { id, label: 'x', serverUrl: 'http://compute.example' };

	it('refuses an id that is not a UUID', () => {
		expect(() => validateIncomingServers([{ ...server, id: 'prod-1' }])).toThrow(/UUID/);
	});

	it('refuses the same id twice', () => {
		expect(() => validateIncomingServers([server, server])).toThrow(/more than once/);
	});
});

describe('assertKeyNotRetargeted', () => {
	const stored = [
		{ id: 'a', serverUrl: 'http://compute.local:6500', hasApiKey: true, apiKey: 'k' }
	];

	it('refuses a new URL that would keep the stored key', () => {
		expect(() =>
			assertKeyNotRetargeted([{ id: 'a', serverUrl: 'https://evil.example' }], stored)
		).toThrow(/Re-enter its API key/);
		expect(() =>
			assertKeyNotRetargeted([{ id: 'a', serverUrl: 'https://evil.example', apiKey: '' }], stored)
		).toThrow(/Re-enter its API key/);
	});

	it('allows a new URL with a new key or a cleared one', () => {
		expect(() =>
			assertKeyNotRetargeted([{ id: 'a', serverUrl: 'https://new.example', apiKey: 'n' }], stored)
		).not.toThrow();
		expect(() =>
			assertKeyNotRetargeted([{ id: 'a', serverUrl: 'https://new.example', apiKey: null }], stored)
		).not.toThrow();
	});

	it('ignores an unchanged URL, a trailing slash, keyless and new servers', () => {
		expect(() =>
			assertKeyNotRetargeted([{ id: 'a', serverUrl: 'http://compute.local:6500/' }], stored)
		).not.toThrow();
		expect(() =>
			assertKeyNotRetargeted(
				[{ id: 'a', serverUrl: 'https://other.example' }],
				[{ id: 'a', serverUrl: 'http://compute.local:6500', hasApiKey: false }]
			)
		).not.toThrow();
		expect(() =>
			assertKeyNotRetargeted([{ id: 'b', serverUrl: 'https://other.example' }], stored)
		).not.toThrow();
	});
});

describe('assertStoredKeysReadable', () => {
	const unreadable = [{ id: 'a', hasApiKey: true, apiKey: undefined }];

	it('refuses to overwrite a key it could not decrypt by leaving it out', () => {
		expect(() => assertStoredKeysReadable([{ id: 'a' }], unreadable)).toThrow(/SELVA_AT_REST_KEY/);
		expect(() => assertStoredKeysReadable([{ id: 'a', apiKey: '' }], unreadable)).toThrow(
			/SELVA_AT_REST_KEY/
		);
	});

	it('lets the operator replace or clear that key', () => {
		expect(() => assertStoredKeysReadable([{ id: 'a', apiKey: 'new' }], unreadable)).not.toThrow();
		expect(() => assertStoredKeysReadable([{ id: 'a', apiKey: null }], unreadable)).not.toThrow();
	});

	it('ignores servers with a readable key or none', () => {
		const stored = [
			{ id: 'a', hasApiKey: true, apiKey: 'k' },
			{ id: 'b', hasApiKey: false }
		];
		expect(() => assertStoredKeysReadable([{ id: 'a' }, { id: 'b' }], stored)).not.toThrow();
	});
});
