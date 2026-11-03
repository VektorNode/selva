// `selva doctor`'s secret check is the only thing standing between an operator
// and a deployment running on a placeholder key. A weak or unset
// SELVA_HMAC_KEY forges sessions; a weak SELVA_AT_REST_KEY weakens the stored
// compute credential. Neither fails at boot, so a check that quietly passed
// would be worse than none.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHmacKey, checkSecret } from '../checks/config.js';
import { generateKey } from '../secrets.js';

const PLACEHOLDER = 'replace-this-with-a-random-32-byte-hex-key';

test('a freshly generated key passes the check that guards it', () => {
	// The contract between `secrets.js` and `doctor`: if generateKey ever stops
	// producing 32 bytes of hex, every new deployment fails its own health check.
	for (let i = 0; i < 20; i++) {
		assert.equal(checkSecret(generateKey(), 'k').severity, 'green');
	}
});

test('generated keys are 64 hex chars and not repeated', () => {
	const a = generateKey();
	const b = generateKey();
	assert.match(a, /^[0-9a-f]{64}$/);
	assert.notEqual(a, b, 'keys must not be deterministic');
});

test('the scaffold placeholder is rejected', () => {
	// create/init write this into .env.example; shipping it means every
	// deployment shares a publicly known key.
	const r = checkSecret(PLACEHOLDER, 'SELVA_HMAC_KEY');
	assert.equal(r.severity, 'red');
	assert.match(r.line, /placeholder/);
});

test('an unset secret is reported as unset, not as a malformed one', () => {
	// The distinction is the whole value of the message: "unset" tells the
	// operator to run `selva init`, "not 64 hex chars" sends them looking at a
	// value that isn't there.
	for (const empty of [undefined, '', null]) {
		const r = checkSecret(empty, 'SELVA_HMAC_KEY');
		assert.equal(r.severity, 'red');
		assert.match(r.line, /unset/, `${JSON.stringify(empty)} should report as unset`);
	}
});

test('a key of the wrong length or alphabet is rejected', () => {
	const short = 'a'.repeat(63);
	const long = 'a'.repeat(65);
	const nonHex = 'g'.repeat(64);
	for (const bad of [short, long, nonHex, 'hunter2']) {
		assert.equal(checkSecret(bad, 'k').severity, 'red', `${bad.slice(0, 12)}… must be rejected`);
	}
});

test('uppercase hex is accepted — operators may paste it from elsewhere', () => {
	assert.equal(checkSecret('A'.repeat(64), 'k').severity, 'green');
});

test('a 32-byte base64 key is accepted, as the runtime accepts it', () => {
	// decodeSecretKey takes hex or base64, and the runtime's own error text
	// suggests `openssl rand -base64 32`; doctor must not red what boots fine.
	const b64 = Buffer.alloc(32, 7).toString('base64');
	assert.equal(checkSecret(b64, 'k').severity, 'green');
	assert.equal(checkSecret(b64.replace(/=+$/, ''), 'k').severity, 'green');
});

test('SELVA_HMAC_KEY is checked by the runtime rule: any 32+ characters, not the placeholder', () => {
	assert.equal(checkHmacKey('x'.repeat(48)).severity, 'green');
	assert.equal(checkHmacKey(generateKey()).severity, 'green');
	assert.equal(checkHmacKey('x'.repeat(31)).severity, 'red');
	assert.equal(checkHmacKey(PLACEHOLDER).severity, 'red');
	assert.match(checkHmacKey(undefined).line, /unset/);
});
