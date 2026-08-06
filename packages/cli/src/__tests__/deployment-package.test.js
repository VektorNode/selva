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
import { buildTargetPackageJson, detectDrift } from '../commands/migrate.js';

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

test('deployment names are coerced to something npm accepts', () => {
	assert.equal(sanitizePackageName('My Deployment'), 'my-deployment');
	assert.equal(sanitizePackageName('...'), 'selva-deployment');
	assert.equal(sanitizePackageName(''), 'selva-deployment');
});
