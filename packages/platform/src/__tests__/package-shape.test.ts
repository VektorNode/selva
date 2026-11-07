import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Transpiled first, so a type-only mention such as `typeof import('sharp')` doesn't count.
function emittedSourcesNamingSharp(): string[] {
	const named: string[] = [];
	const src = join(root, 'src');
	for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
		const file = join(entry.parentPath, entry.name);
		const path = relative(src, file);
		if (!entry.isFile() || !path.endsWith('.ts')) continue;
		if (path.startsWith('testing') || path.includes('__tests__')) continue;
		const js = ts.transpileModule(readFileSync(file, 'utf8'), {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
		}).outputText;
		if (/\bfrom\s*['"]sharp['"]|\b(?:import|require)\(\s*['"]sharp['"]\s*\)/.test(js)) {
			named.push(path);
		}
	}
	return named;
}

describe('bundling the root barrel', () => {
	it('declares no side effects, so one constant does not pull in the package', () => {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		expect(pkg.sideEffects).toBe(false);
	});

	// Transpiles every source file: well past the default timeout under a loaded turbo run.
	it(
		"never names sharp in an import a bundler would resolve, which browser builds can't",
		{
			timeout: 20_000
		},
		() => {
			expect(emittedSourcesNamingSharp()).toEqual([]);
		}
	);
});
