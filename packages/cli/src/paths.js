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

/**
 * A scaffolding template shipped inside the installed runtime. The CLI cannot
 * import from `@selvajs/selva` — it is what installs it — so it reads the files
 * out of node_modules after install.
 */
export function runtimeTemplatePath(dir, name) {
	return join(dir, 'node_modules', '@selvajs', 'selva', 'templates', name);
}

/**
 * The `.env` template to merge operator values into: the runtime's `.env.example`
 * when installed, otherwise the deployment's own `.env` so its comments and
 * ordering survive a rewrite.
 *
 * Returns `''` when neither exists rather than throwing — `renderEnvValues`
 * writes every value it was given even with no template to order them by, so
 * the operator gets a usable file instead of an ENOENT from a command that was
 * only asked to change one key.
 */
export function readEnvTemplate(dir) {
	const template = runtimeTemplatePath(dir, '.env.example');
	if (existsSync(template)) return readFileSync(template, 'utf8');
	const env = join(dir, '.env');
	if (existsSync(env)) return readFileSync(env, 'utf8');
	return '';
}

// Either .env or ecosystem.config.cjs is enough — selva.config.js and
// node_modules are expected too, but init should still fix a partial install.
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
