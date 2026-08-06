// `create` and `migrate` both write a deployment's package.json. They used to
// build it separately and had already drifted — migrate un-pinned pm2 to a
// caret range, reintroducing the daemon skew the exact pin exists to prevent
// (#118). These pin the agreement.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	buildDeploymentPackageJson,
	sanitizePackageName,
	DEPENDENCIES,
	LEGACY_DEPENDENCIES
} from '../deployment-package.js';
import { buildTargetPackageJson, detectDrift, diffPackageJson } from '../commands/migrate.js';

test('pm2 is pinned exactly — a range lets the CLI and daemon drift apart', () => {
	assert.match(DEPENDENCIES.pm2, /^\d+\.\d+\.\d+$/, 'pm2 must be an exact version, not a range');
});

test('migrate produces exactly what create scaffolds, apart from name and version', () => {
	const created = buildDeploymentPackageJson({ name: 'my-deployment' });
	const migrated = buildTargetPackageJson({ name: 'my-deployment', version: '0.1.0' });
	assert.deepEqual(migrated, created);
});

test('a freshly created deployment reports no drift', () => {
	// Otherwise `selva doctor` would tell every new operator to run `selva migrate`.
	assert.deepEqual(detectDrift(buildDeploymentPackageJson({ name: 'd' }), null), []);
});

test('every legacy package is reported as drift', () => {
	for (const name of Object.keys(LEGACY_DEPENDENCIES)) {
		const pkg = buildDeploymentPackageJson({ name: 'd' });
		pkg.dependencies[name] = '1.0.0';
		const reasons = detectDrift(pkg, null);
		assert.ok(
			reasons.some((r) => r.startsWith(name)),
			`${name} should be reported as drift`
		);
	}
});

test('a missing canonical dependency is reported as drift', () => {
	for (const name of Object.keys(DEPENDENCIES)) {
		const pkg = buildDeploymentPackageJson({ name: 'd' });
		delete pkg.dependencies[name];
		assert.ok(
			detectDrift(pkg, null).includes(`${name} is missing`),
			`a missing ${name} should be reported`
		);
	}
});

// ── What a migration discards ───────────────────────────────────────────

test('engines survives a migration', () => {
	// npm only enforces engines under `engine-strict`, so an operator who pinned
	// a Node floor did it deliberately. Dropping it removes a guard whose
	// absence shows up only under real traffic (issue #176).
	const migrated = buildTargetPackageJson({
		name: 'd',
		version: '1.0.0',
		engines: { node: '>=22.0.0' }
	});
	assert.deepEqual(migrated.engines, { node: '>=22.0.0' });
});

test('a deployment without engines does not gain an empty one', () => {
	assert.equal('engines' in buildDeploymentPackageJson({ name: 'd' }), false);
});

test('every field the rewrite discards is listed in the diff', () => {
	// The rewrite is wholesale by design, but the operator confirms it — so
	// anything dropped has to be shown. devDependencies and description used to
	// vanish without ever appearing in the prompt.
	const before = {
		name: 'd',
		version: '1.0.0',
		dependencies: { '@selvajs/selva': 'latest', '@selvajs/cli': 'latest', pm2: '5.4.3' },
		scripts: { ...buildDeploymentPackageJson({ name: 'd' }).scripts },
		devDependencies: { vitest: '^2.0.0' },
		description: 'Acme internal deployment',
		pnpm: { overrides: {} }
	};
	const diff = diffPackageJson(before, buildTargetPackageJson(before));
	// picocolors wraps each line in ANSI codes; build the escape rather than
	// embedding a raw control character in the source.
	const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
	const plain = diff.map((l) => l.replace(ansi, ''));

	for (const dropped of ['devDependencies', 'description', 'pnpm']) {
		assert.ok(
			plain.some((l) => l.startsWith(`- ${dropped}`)),
			`${dropped} must be reported as dropped`
		);
	}
});

test('canonical fields are not reported as dropped', () => {
	// They survive the rewrite, so listing them would be a lie.
	const before = buildDeploymentPackageJson({ name: 'd', engines: { node: '>=22.0.0' } });
	const diff = diffPackageJson(before, buildTargetPackageJson({ ...before, version: '0.1.0' }));
	assert.deepEqual(diff, [], 'an already-canonical package.json has nothing to report');
});

test('deployment names are coerced to something npm accepts', () => {
	assert.equal(sanitizePackageName('My Deployment'), 'my-deployment');
	assert.equal(sanitizePackageName('...'), 'selva-deployment');
	assert.equal(sanitizePackageName(''), 'selva-deployment');
});
