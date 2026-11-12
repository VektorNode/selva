#!/usr/bin/env node

// One step of downgrade-check.mjs, run against one build of the local provider.
// The provider and platform are imported by file path, so the same data folder
// can be handed to the published stable build and to this checkout's build in
// turn. Prints one JSON line.
//
//   node downgrade-check-worker.mjs <provider entry> <platform entry> <data dir> <step>

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [providerEntry, platformEntry, dataDir, step] = process.argv.slice(2);

const { LocalComputeServerStore } = await import(pathToFileURL(providerEntry).href);
const { SYSTEM_CONTEXT } = await import(pathToFileURL(platformEntry).href);

// Fixed, so every build opens the same envelopes.
const AT_REST_KEY = Buffer.alloc(32, 0x42);
const SERVERS = {
	seeded: { id: '11111111-1111-4111-8111-111111111111', key: 'seed-key' },
	touched: { id: '22222222-2222-4222-8222-222222222222', key: 'touch-key' }
};

const store = new LocalComputeServerStore(join(dataDir, 'compute.config.json'), AT_REST_KEY);

function row(name) {
	return {
		id: SERVERS[name].id,
		scope: 'platform',
		sharedWith: 'all',
		label: name,
		serverUrl: `http://${name}.compute.example:5000`,
		apiKey: SERVERS[name].key
	};
}

const steps = {
	async seed() {
		await store.savePlatformServers(SYSTEM_CONTEXT, [row('seeded')], SERVERS.seeded.id);
		return {};
	},

	// What the app does on every start: re-seal, then verify.
	async boot() {
		const resealed =
			typeof store.reencryptSecrets === 'function' ? await store.reencryptSecrets() : 0;
		const report = await store.verifySecrets();
		return { resealed, verified: report.ok, failures: report.failures };
	},

	// An admin save by this build: every row is written again, plus a new one.
	async touch() {
		await store.savePlatformServers(
			SYSTEM_CONTEXT,
			[row('seeded'), row('touched')],
			SERVERS.seeded.id
		);
		return {};
	},

	async read() {
		const keys = {};
		for (const [name, { id, key }] of Object.entries(SERVERS)) {
			try {
				const stored = await store.getServerApiKey(SYSTEM_CONTEXT, id);
				keys[name] = stored === undefined ? 'absent' : stored === key ? 'ok' : 'wrong';
			} catch (err) {
				keys[name] = `threw: ${err instanceof Error ? err.message : String(err)}`;
			}
		}
		return { keys };
	}
};

if (!steps[step]) throw new Error(`Unknown step: ${step}`);
console.log(JSON.stringify(await steps[step]()));
