/**
 * The apiKey merge is shared by the platform and org compute-config writes. A
 * divergence between those two paths silently clears or leaks a stored
 * credential and nothing fails at build time — hence the coverage here rather
 * than through either route.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { env } from '$env/dynamic/private';
import {
	resolveApiKey,
	storedKeysById,
	validateIncomingServers,
	type IncomingServerBase
} from '../serverConfigWrite.js';

const server = (over: Partial<IncomingServerBase> = {}): IncomingServerBase => ({
	id: 'srv-1',
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
		expect(() => validateIncomingServers([server(), server({ id: 'srv-2' })])).not.toThrow();
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
 * solve, so validation here is the SSRF gate — see SEL-3. The private-range
 * half is opt-out because a compute server on the LAN is an ordinary
 * self-hosted layout; the scheme allowlist never is.
 */
describe('validateIncomingServers — SSRF guard on serverUrl', () => {
	afterEach(() => {
		delete env.COMPUTE_ALLOW_PRIVATE_SERVER_URL;
	});

	it.each([
		['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
		['metadata as an integer literal', 'http://2852039166/'],
		['loopback', 'http://127.0.0.1:6500'],
		['loopback by name', 'http://localhost:6500'],
		['RFC1918', 'http://10.0.0.5:6500'],
		['IPv6 loopback', 'http://[::1]:6500']
	])('rejects %s by default', (_case, serverUrl) => {
		expect(() => validateIncomingServers([server({ serverUrl })])).toThrow();
	});

	it.each([
		['file', 'file:///etc/passwd'],
		['gopher', 'gopher://compute.example.test/'],
		['javascript', 'javascript:alert(1)']
	])('rejects the %s scheme even when private addresses are allowed', (_case, serverUrl) => {
		env.COMPUTE_ALLOW_PRIVATE_SERVER_URL = 'true';
		expect(() => validateIncomingServers([server({ serverUrl })])).toThrow();
	});

	it('allows a private address once the operator opts in', () => {
		env.COMPUTE_ALLOW_PRIVATE_SERVER_URL = 'true';
		expect(() =>
			validateIncomingServers([server({ serverUrl: 'http://10.0.0.5:6500' })])
		).not.toThrow();
	});

	it('always allows an ordinary public https endpoint', () => {
		expect(() =>
			validateIncomingServers([server({ serverUrl: 'https://compute.example.test' })])
		).not.toThrow();
	});
});
