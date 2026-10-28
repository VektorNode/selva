#!/usr/bin/env node

/**
 * Builds the production plugin and installs it into Rhino's yak package folders,
 * so Rhino loads it exactly like a released install. Restart Rhino afterwards.
 *
 * `--skip-build` reinstalls the last build.
 */

import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const projectRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
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

function rhinoIsRunning() {
	try {
		const cmd =
			process.platform === 'win32'
				? 'tasklist /FI "IMAGENAME eq Rhino.exe" /NH'
				: 'pgrep -x Rhinoceros';
		return /Rhino/i.test(execSync(cmd, { encoding: 'utf-8' }));
	} catch {
		return false;
	}
}

const csproj = readFileSync(join(projectRoot, 'Plugin/Selva.GH/Selva.GH.csproj'), 'utf-8');
const version = csproj.match(/<Version>([^<]+)<\/Version>/)?.[1].trim();
if (!version) throw new Error('No <Version> in Selva.GH.csproj');

if (rhinoIsRunning()) {
	console.error('Rhino is running and locks Selva.gha. Close it and rerun.');
	process.exit(1);
}

if (!process.argv.includes('--skip-build')) {
	execSync('pnpm run build:plugin', { cwd: projectRoot, stdio: 'inherit' });
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
	console.log(`Rhino ${rhino}: installed ${version} -> ${versionDir}`);
}

console.log('\nRestart Rhino to load it.');
