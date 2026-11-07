// Run: node --test scripts/release/changeset-publish.test.mjs
//
// The wrapper runs against a stand-in `changeset publish`, a stub package list
// and a stub registry on localhost, so no case touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = join(here, 'changeset-publish.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'changeset-publish-test-'));

const PACKAGES = [
	['@selvajs/cli', '4.7.0', 'packages/cli'],
	['@selvajs/compute', '5.0.1', 'packages/compute']
];

/** A stand-in `changeset publish` that exits with `code`. */
function fakePublisher(name, code, output = '') {
	const path = join(workDir, `${name}.mjs`);
	writeFileSync(path, `process.stdout.write(${JSON.stringify(output)});\nprocess.exit(${code});\n`);
	return path;
}

function fakePackageList() {
	const path = join(workDir, 'list.mjs');
	const lines = PACKAGES.map((p) => p.join('\t')).join('\n');
	writeFileSync(path, `process.stdout.write(${JSON.stringify(lines + '\n')});\n`);
	return path;
}

/** Serves `GET /<name>/<version>` for each published `name@version`; 404 otherwise. */
async function stubRegistry(published) {
	const requests = [];
	const server = createServer((req, res) => {
		const [name, version] = decodeURIComponent(req.url.slice(1)).split(/\/(?=[^/]+$)/);
		requests.push(`${name}@${version}`);
		if (!published.includes(`${name}@${version}`)) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version }));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		requests,
		close: () => server.close()
	};
}

// Async: the stub registry answers from this process, so a sync spawn would deadlock.
async function runWrapper(publisher, registry) {
	const child = spawn(process.execPath, [wrapper], {
		env: {
			...process.env,
			SELVA_FAKE_CHANGESET_PUBLISH: publisher,
			SELVA_FAKE_PACKAGE_LIST: fakePackageList(),
			SELVA_VERIFY_REGISTRY: registry.url,
			SELVA_VERIFY_WAIT_MS: '0'
		}
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (d) => (stdout += d));
	child.stderr.on('data', (d) => (stderr += d));
	const [status] = await once(child, 'close');
	return { status, stdout, stderr };
}

test('passes through a successful publish without touching the registry', async (t) => {
	const registry = await stubRegistry([]);
	t.after(registry.close);
	const r = await runWrapper(fakePublisher('ok', 0), registry);
	assert.equal(r.status, 0);
	assert.deepEqual(registry.requests, []);
});

test('forgives a failed publish when every version is already on the registry', async (t) => {
	const registry = await stubRegistry(PACKAGES.map(([name, version]) => `${name}@${version}`));
	t.after(registry.close);
	// changesets misreads pnpm's plain-text "already published" error as a failure.
	const r = await runWrapper(
		fakePublisher(
			'already-published',
			1,
			'npm error You cannot publish over the previously published versions: 4.7.0.\n'
		),
		registry
	);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /@selvajs\/cli@4\.7\.0 — on npm/);
	assert.match(r.stdout, /@selvajs\/compute@5\.0\.1 — on npm/);
});

test('fails when one workspace version is not on the registry', async (t) => {
	const registry = await stubRegistry(['@selvajs/cli@4.7.0']);
	t.after(registry.close);
	const r = await runWrapper(fakePublisher('partly-published', 1), registry);
	assert.notEqual(r.status, 0, 'a version the registry does not serve must keep the release red');
	assert.match(r.stderr, /not on npm/);
	assert.match(r.stderr, /@selvajs\/compute@5\.0\.1/);
	assert.doesNotMatch(r.stderr, /@selvajs\/cli@4\.7\.0/);
});

test('fails when the registry cannot be reached', async () => {
	const registry = await stubRegistry([]);
	registry.close();
	const r = await runWrapper(fakePublisher('unreachable', 1), registry);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /not on npm/);
});
