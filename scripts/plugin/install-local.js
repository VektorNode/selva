#!/usr/bin/env node

/**
 * Builds the production plugin and installs it into Rhino's yak package folders,
 * so Rhino loads it exactly like a released install. Restart Rhino afterwards.
 *
 * `--skip-build` reinstalls the last build. `--dev` also drops the marker that makes this a
 * development install: a log at <LocalAppData>/Selva/dev/selva.log (`pnpm plugin:logs`), a file per
 * live session that `pnpm plugin:session`, `lab:record` and `bridge-drive` connect through, and
 * the Selva app, which `--dev` builds into the package. A plain install wipes the version folder,
 * so it turns all of that off again.
 */

import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { projectRoot, readPluginVersion } from './shared.mjs';

const yakStagingRoot = join(projectRoot, 'Plugin/Selva.GH/bin/Yak');

const packagesRoot =
	process.platform === 'win32'
		? join(process.env.APPDATA ?? '', 'McNeel/Rhinoceros/packages')
		: join(homedir(), 'Library/Application Support/McNeel/Rhinoceros/packages');

// `yak install <file>` always targets the Rhino 8 folder, so copy the staged
// packages in directly.
const targets = [
	{ staging: 'rh-8', rhino: '8.0' },
	{ staging: 'rh-9', rhino: '9.0' }
];

// compute.geometry hosts Rhino and loads Selva.gha too, so it locks the folder as well.
const lockingProcesses =
	process.platform === 'win32' ? ['Rhino.exe', 'compute.geometry.exe', 'rhino.compute.exe'] : [];

function runningLockers() {
	if (process.platform !== 'win32') {
		try {
			return /\d/.test(execSync('pgrep -x Rhinoceros', { encoding: 'utf-8' }))
				? ['Rhinoceros']
				: [];
		} catch {
			return [];
		}
	}
	try {
		const out = execSync('tasklist /NH', { encoding: 'utf-8' }).toLowerCase();
		return lockingProcesses.filter((name) => out.includes(name.toLowerCase()));
	} catch {
		return [];
	}
}

const version = readPluginVersion();

const dev = process.argv.includes('--dev');

const lockers = runningLockers();
if (lockers.length > 0) {
	console.error(`${lockers.join(', ')} running and locking Selva.gha. Close and rerun.`);
	process.exit(1);
}

if (!process.argv.includes('--skip-build')) {
	execSync(`pnpm run build:plugin${dev ? ' --with-app' : ''}`, {
		cwd: projectRoot,
		stdio: 'inherit'
	});
}

for (const { staging, rhino } of targets) {
	const source = join(yakStagingRoot, staging);
	if (!existsSync(source)) {
		console.warn(`Skipping Rhino ${rhino}: ${source} was not built`);
		continue;
	}
	const pluginDir = join(packagesRoot, rhino, 'Selva');
	const versionDir = join(pluginDir, version);
	rmSync(versionDir, { recursive: true, force: true });
	mkdirSync(versionDir, { recursive: true });
	cpSync(source, versionDir, {
		recursive: true,
		filter: (src) => !src.endsWith('.yak')
	});
	writeFileSync(join(pluginDir, 'manifest.txt'), version);
	if (dev) {
		writeFileSync(
			join(versionDir, 'selva.dev.json'),
			JSON.stringify({ installedAt: new Date().toISOString() }, null, '\t')
		);
	}
	console.log(`Rhino ${rhino}: installed ${version}${dev ? ' (dev)' : ''} -> ${versionDir}`);
}

console.log('\nRestart Rhino to load it.');
if (dev) console.log('Then: pnpm plugin:logs, and pnpm plugin:session once a UI Bridge runs.');
