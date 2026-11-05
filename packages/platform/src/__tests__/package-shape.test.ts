import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('bundling the root barrel', () => {
	it('declares no side effects, so one constant does not pull in the package', () => {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		expect(pkg.sideEffects).toBe(false);
	});

	it("does not name sharp statically, which browser builds can't resolve", () => {
		const source = readFileSync(join(root, 'src/storage/image.ts'), 'utf8');
		expect(source).not.toMatch(/await import\(\s*['"]sharp['"]/);
	});
});
