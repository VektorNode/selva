import { describe, expect, it } from 'vitest';
import * as root from '../index.js';
import * as computeServer from '../computeServer/index.js';

describe('the root barrel', () => {
	it.each([
		'encryptSecret',
		'decryptSecret',
		'decryptWithKeys',
		'decodeSecretKey',
		'isEncryptedSecret',
		'isUnknownEnvelope',
		'readAtRestKeys'
	])('leaves out %s, which needs node:crypto', (name) => {
		expect(root).not.toHaveProperty(name);
		expect(computeServer).toHaveProperty(name);
	});
});
