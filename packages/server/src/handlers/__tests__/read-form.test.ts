import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const handlersDir = resolve(__dirname, '..');

// The idempotency fingerprint has already read the body by the time a handler
// runs, so `request.formData()` throws "body used", and only on requests that
// carry an Idempotency-Key. Tests without the header never see it.
describe('handlers read forms through readForm', () => {
	it.each(readdirSync(handlersDir).filter((f) => f.endsWith('.ts')))('%s', (file) => {
		const source = readFileSync(join(handlersDir, file), 'utf8');
		expect(source).not.toMatch(/\.formData\(\)/);
	});
});
