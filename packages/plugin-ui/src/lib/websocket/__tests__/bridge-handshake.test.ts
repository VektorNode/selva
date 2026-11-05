// The plugin's BridgeAccessTests read the same fixture, so the two sides can't drift.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	authenticateMessage,
	BRIDGE_UNAUTHORIZED_CLOSE_CODE,
	isAuthenticatedMessage,
	MAX_HOST_FILE_BYTES,
	roleOf
} from '../bridge-handshake';

const fixture = JSON.parse(
	readFileSync(
		new URL('../../../../../schemas/fixtures/bridge-handshake.json', import.meta.url),
		'utf-8'
	)
);

describe('bridge handshake (cross-stack with BridgeAccessTests)', () => {
	it('sends the authenticate message the plugin expects', () => {
		expect(authenticateMessage(fixture.authenticate.secret)).toEqual(fixture.authenticate);
	});

	it('declares the Rhino panel host the way the plugin expects', () => {
		const { secret, host } = fixture.authenticateFromPanel;
		expect(authenticateMessage(secret, host)).toEqual(fixture.authenticateFromPanel);
	});

	it('refuses a save over the size the plugin accepts', () => {
		expect(MAX_HOST_FILE_BYTES).toBe(fixture.maxHostFileBytes);
	});

	it('recognises the plugin acknowledgement', () => {
		expect(isAuthenticatedMessage(fixture.authenticated)).toBe(true);
		expect(isAuthenticatedMessage({ type: 'initialData' })).toBe(false);
		expect(isAuthenticatedMessage(null)).toBe(false);
	});

	it('reads the role the plugin acknowledges the socket with', () => {
		expect(roleOf(fixture.authenticated)).toBe('author');
		expect(roleOf(fixture.authenticatedAsPlayer)).toBe('player');
		expect(roleOf({ type: 'authenticated' })).toBe('author');
	});

	it('stops retrying on the close code the plugin refuses with', () => {
		expect(BRIDGE_UNAUTHORIZED_CLOSE_CODE).toBe(fixture.unauthorizedCloseCode);
	});
});
