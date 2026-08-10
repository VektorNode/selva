// `create` and `migrate` both write a deployment's package.json. They used to
// build it separately and had already drifted — migrate un-pinned pm2 to a
// caret range, reintroducing the daemon skew the exact pin exists to prevent
// (#118). These pin the agreement.
//
// Run by `pnpm test` via node's built-in runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	buildDeploymentPackageJson,
	isFloatingPin,
	isPrereleasePin,
	resolveSelvaPins,
	sanitizePackageName,
	DEPENDENCIES,
	LEGACY_DEPENDENCIES,
	SELVA_PACKAGES
} from '../deployment-package.js';
import {
	buildTargetPackageJson,
	buildPm2UpgradeNotice,
	detectDrift,
	diffPackageJson
} from '../commands/migrate.js';

// Every test here resolves pins through a stub — the real one shells out to
// `npm view`. STABLE is what the registry's `latest` tag points at.
const STABLE = '4.7.3';
const stubResolve = () => STABLE;
const offlineResolve = () => {
	throw new Error('offline');
};

/** buildTargetPackageJson returns {pkg, notes}; most tests only want the pkg. */
const target = (current, resolve = stubResolve) => buildTargetPackageJson(current, resolve).pkg;

test('pm2 is pinned exactly — a range lets the CLI and daemon drift apart', () => {
	assert.match(DEPENDENCIES.pm2, /^\d+\.\d+\.\d+$/, 'pm2 must be an exact version, not a range');
});

test('the pm2 pin comes from the CLI manifest, so Dependabot can see it', () => {
	// A literal in source is invisible to Dependabot, which is how this pin sat
	// on 5.4.3 while upstream reached 7.x. Reading it from devDependencies is
	// what makes the bump arrive as a normal PR.
	const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
	assert.equal(DEPENDENCIES.pm2, manifest.devDependencies?.pm2);
	assert.match(
		manifest.devDependencies?.pm2 ?? '',
		/^\d+\.\d+\.\d+$/,
		'the manifest entry itself must be exact — a caret there reaches every deployment'
	);
});

test('the scaffold ships the js-yaml security override', () => {
	// pm2 pins a js-yaml with a known DoS; the fix exists upstream (4.3.1) but
	// pm2 hasn't adopted it. The override forces the patched version into every
	// deployment. Delete override + test when pm2's own dep reaches >= 4.3.1.
	const pkg = buildDeploymentPackageJson({ name: 'd' });
	assert.equal(pkg.overrides['js-yaml'], '^4.3.1');
});

test('a deployment without the override is reported as drift', () => {
	// Without drift, existing deployments keep installing the vulnerable
	// js-yaml on every `npm install` and nothing ever says so.
	const pkg = buildDeploymentPackageJson({ name: 'd' });
	delete pkg.overrides;
	const reasons = detectDrift(pkg, null);
	assert.ok(
		reasons.some((r) => r.includes('overrides.js-yaml')),
		`expected an overrides reason, got: ${JSON.stringify(reasons)}`
	);
});

test('an overrides-only difference shows up in the migrate diff', () => {
	// diffPackageJson drives both the confirmation prompt and the
	// nothing-to-migrate early exit — if overrides changes were invisible here,
	// migrate would report "already current" and the shim would never land.
	const before = buildDeploymentPackageJson({ name: 'd' });
	delete before.overrides;
	const after = buildDeploymentPackageJson({ name: 'd' });
	const lines = diffPackageJson(before, after);
	assert.ok(
		lines.some((l) => l.includes('overrides.js-yaml')),
		`expected an overrides.js-yaml line, got: ${JSON.stringify(lines)}`
	);
});

test('a pm2 pin change makes migrate tell the operator how to finish', () => {
	// After migrate installs the new pm2, the daemon still runs the old one.
	// Nothing else says so at that moment — this notice is the only pointer.
	const notice = buildPm2UpgradeNotice('5.4.3', DEPENDENCIES.pm2);
	assert.match(notice, /npx pm2 update/);
	assert.match(notice, /npx pm2 save/);
	assert.match(notice, /5\.4\.3/);

	// `pm2 update` empties the process table before restoring it. When the
	// restore fails, the next instruction used to be `pm2 save`, which would
	// overwrite dump.pm2 — the only record of what to bring back. Verify first.
	assert.match(notice, /npx pm2 list/);
	assert.ok(
		notice.indexOf('pm2 list') < notice.indexOf('pm2 save'),
		'the verification step must come before save'
	);
	assert.match(notice, /resurrect/);

	// No pin change (or a fresh scaffold with no prior pm2) → no notice.
	assert.equal(buildPm2UpgradeNotice(DEPENDENCIES.pm2, DEPENDENCIES.pm2), null);
	assert.equal(buildPm2UpgradeNotice(undefined, DEPENDENCIES.pm2), null);
});

test('a deployment pinned to an older pm2 is reported as drift', () => {
	// Presence alone was checked before, which let a deployment scaffolded
	// against an older CLI keep its pm2 forever without doctor saying anything.
	const pkg = buildDeploymentPackageJson({ name: 'd' });
	pkg.dependencies.pm2 = '4.5.6';
	const reasons = detectDrift(pkg, null);
	assert.ok(
		reasons.some((r) => r.includes('pm2 is pinned to 4.5.6')),
		`expected a stale-pin reason, got: ${JSON.stringify(reasons)}`
	);
});

test('migrate produces exactly what create scaffolds, apart from name and version', () => {
	// Both resolve their pins the same way, so compare against a scaffold built
	// with the same resolved pins rather than the raw dist-tag defaults.
	const { pins } = resolveSelvaPins({}, stubResolve);
	const created = buildDeploymentPackageJson({ name: 'my-deployment', dependencies: pins });
	const migrated = target({ name: 'my-deployment', version: '0.1.0' });
	assert.deepEqual(migrated, created);
});

test('a freshly created deployment reports no drift', () => {
	// Otherwise `selva doctor` would tell every new operator to run `selva migrate`.
	// `create` resolves the dist-tags before writing, so mirror that here — the
	// bare defaults still carry `latest`, which is itself drift.
	const { pins } = resolveSelvaPins({}, stubResolve);
	assert.deepEqual(
		detectDrift(buildDeploymentPackageJson({ name: 'd', dependencies: pins }), null),
		[]
	);
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

// ── Version pins ────────────────────────────────────────────────────────
//
// A deployment on `^4.8.0-beta.11` ran `selva migrate` and came back on 4.7.3.
// The scaffold pinned both `@selvajs/*` packages to the `latest` dist-tag,
// migrate rewrote package.json onto the scaffold wholesale, and npm's `latest`
// means newest *stable* — so the beta line resolved backwards. The diff said
// `^4.8.0-beta.11 → latest`, which reads as an upgrade, and doctor compared CLI
// against runtime, which had both moved together and so reported "aligned".

test('a prerelease pin survives a migration', () => {
	// The whole bug in one assertion: `latest` is the newest stable, so
	// resolving a beta pin through it walks the deployment backwards.
	const migrated = target({
		name: 'd',
		dependencies: { '@selvajs/selva': '^4.8.0-beta.11', '@selvajs/cli': '^4.8.0-beta.11' }
	});
	assert.equal(migrated.dependencies['@selvajs/selva'], '^4.8.0-beta.11');
	assert.equal(migrated.dependencies['@selvajs/cli'], '^4.8.0-beta.11');
});

test('migrate never writes a floating dist-tag', () => {
	// A stored tag re-resolves on every later `npm install`, so the deployment
	// follows the tag forever — it can move with no migrate at all.
	for (const current of [{}, { '@selvajs/selva': 'latest', '@selvajs/cli': 'latest' }]) {
		const deps = target({ name: 'd', dependencies: current }).dependencies;
		for (const name of SELVA_PACKAGES) {
			assert.equal(deps[name], `^${STABLE}`, `${name} must resolve to a concrete version`);
			assert.ok(!isFloatingPin(deps[name]));
		}
	}
});

test('a stable pin is advanced to the current release', () => {
	// Preserving every pin would make migrate layout-only and strand stable
	// deployments on whatever they were scaffolded against.
	const migrated = target({ name: 'd', dependencies: { '@selvajs/selva': '^4.5.0' } });
	assert.equal(migrated.dependencies['@selvajs/selva'], `^${STABLE}`);
});

test('an unreachable registry keeps the existing pin instead of inventing one', () => {
	// Offline, or a package with no such tag. The rest of the migration (layout,
	// overrides, env renames) is still valid, so this reports rather than aborts.
	const { pins, notes } = resolveSelvaPins(
		{ '@selvajs/selva': '^4.5.0', '@selvajs/cli': '^4.5.0' },
		offlineResolve
	);
	assert.equal(pins['@selvajs/selva'], '^4.5.0');
	assert.equal(notes.length, 2);
	assert.ok(notes.every((n) => n.kind === 'unresolved'));
});

test('offline with a floating pin falls back to the tag so the install still works', () => {
	const { pins, notes } = resolveSelvaPins({ '@selvajs/selva': 'latest' }, offlineResolve);
	assert.equal(pins['@selvajs/selva'], 'latest');
	assert.ok(notes.some((n) => n.name === '@selvajs/selva' && n.kind === 'unresolved'));
});

test('a preserved prerelease is reported, not silently kept', () => {
	// It shows as "no change" in the diff, so without the note the operator
	// cannot tell a deliberate hold from a migration that did nothing.
	const { notes } = resolveSelvaPins({ '@selvajs/selva': '^4.8.0-beta.11' }, stubResolve);
	assert.ok(notes.some((n) => n.name === '@selvajs/selva' && n.kind === 'prerelease'));
});

test('a floating pin is reported as drift', () => {
	// Deployments migrated before this fix all carry one, and nothing else
	// reports it: doctor's other version check compares CLI against runtime,
	// which both moved together.
	const pkg = buildDeploymentPackageJson({ name: 'd' });
	pkg.dependencies['@selvajs/selva'] = 'latest';
	assert.ok(
		detectDrift(pkg, null).some((r) => r.includes('@selvajs/selva') && r.includes('floating')),
		`expected a floating-pin reason, got: ${JSON.stringify(detectDrift(pkg, null))}`
	);
});

test('a concrete pin is not reported as drift', () => {
	const { pins } = resolveSelvaPins({}, stubResolve);
	const pkg = buildDeploymentPackageJson({ name: 'd', dependencies: pins });
	assert.deepEqual(detectDrift(pkg, null), []);
});

test('pin classification', () => {
	assert.ok(isFloatingPin('latest'));
	assert.ok(isFloatingPin('beta'));
	assert.ok(isFloatingPin('*'));
	assert.ok(isFloatingPin(''));
	assert.ok(isFloatingPin(undefined));
	assert.ok(!isFloatingPin('^4.7.3'));
	assert.ok(!isFloatingPin('4.8.0-beta.11'));

	assert.ok(isPrereleasePin('^4.8.0-beta.11'));
	assert.ok(isPrereleasePin('4.8.0-rc.1'));
	assert.ok(!isPrereleasePin('^4.7.3'));
	assert.ok(!isPrereleasePin('latest'));
});

// ── What a migration discards ───────────────────────────────────────────

test('engines survives a migration', () => {
	// npm only enforces engines under `engine-strict`, so an operator who pinned
	// a Node floor did it deliberately. Dropping it removes a guard whose
	// absence shows up only under real traffic (issue #176).
	const migrated = target({
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
	const diff = diffPackageJson(before, target(before));
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
	const { pins } = resolveSelvaPins({}, stubResolve);
	const before = buildDeploymentPackageJson({
		name: 'd',
		engines: { node: '>=22.0.0' },
		dependencies: pins
	});
	const diff = diffPackageJson(before, target({ ...before, version: '0.1.0' }));
	assert.deepEqual(diff, [], 'an already-canonical package.json has nothing to report');
});

test('deployment names are coerced to something npm accepts', () => {
	assert.equal(sanitizePackageName('My Deployment'), 'my-deployment');
	assert.equal(sanitizePackageName('...'), 'selva-deployment');
	assert.equal(sanitizePackageName(''), 'selva-deployment');
});
