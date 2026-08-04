import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Node floor Selva requires, read from this CLI's own `engines.node`.
 *
 * Never hardcode it: the CLI, runtime, and server all declare the same range in
 * package.json, and a copy in code silently keeps enforcing the old floor after
 * a bump. Falls back to null (skip the check) rather than guessing a number —
 * refusing to scaffold on a wrong guess is worse than not checking.
 */
export function requiredNodeRange() {
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
		const range = pkg.engines?.node;
		return typeof range === 'string' ? range : null;
	} catch {
		return null;
	}
}

// A deployment directory must contain an .env and an ecosystem.config.cjs.
// Anything else (selva.config.js, node_modules) is "should be there" but the
// CLI doesn't require it — `selva init` is allowed to fix a partial install.
export function isDeploymentDir(dir) {
	return existsSync(join(dir, '.env')) || existsSync(join(dir, 'ecosystem.config.cjs'));
}

export function requireDeploymentDir(dir) {
	if (!isDeploymentDir(dir)) {
		throw new Error(
			`Not a Selva deployment directory: ${dir}\n` +
				`Expected to find .env or ecosystem.config.cjs here. ` +
				`Run \`npx @selvajs/cli <dir>\` first, or cd into an existing deployment.`
		);
	}
}

export function resolveDeploymentDir(cwd = process.cwd()) {
	return resolve(cwd);
}

export function isEmptyOrMissing(dir) {
	if (!existsSync(dir)) return true;
	try {
		return readdirSync(dir).length === 0;
	} catch {
		return false;
	}
}
