import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

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
				`Run \`npx @selvajs/create <dir>\` first, or cd into an existing deployment.`
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
