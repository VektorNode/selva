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
