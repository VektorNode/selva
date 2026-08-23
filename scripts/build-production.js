#!/usr/bin/env node

/**
 * Production build script for Selva
 * Builds web assets and embeds them into the Grasshopper plugin
 * Cross-platform compatible (Windows, macOS, Linux)
 */

import { execSync } from 'child_process';
import { rmSync, cpSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..');

// Single source of truth for the plugin version: Selva.GH.csproj <Version>.
// We substitute it into the yak manifest ourselves rather than leaving yak's
// `$version` token to resolve — token resolution depends on yak inspecting an
// assembly in the staging root, which is empty for multi-TFM packages (the
// .gha lives in TFM subfolders), so it fails on clean CI runners.
function readPluginVersion() {
	const csprojPath = join(projectRoot, 'Plugin/Selva.GH/Selva.GH.csproj');
	const csproj = readFileSync(csprojPath, 'utf-8');
	const match = csproj.match(/<Version>([^<]+)<\/Version>/);
	if (!match) {
		throw new Error(`Could not find <Version> in ${csprojPath}`);
	}
	return match[1].trim();
}

// Colors for output
const COLORS = {
	RESET: '\x1b[0m',
	BOLD: '\x1b[1m',
	GREEN: '\x1b[32m',
	RED: '\x1b[31m',
	YELLOW: '\x1b[33m',
	BLUE: '\x1b[34m'
};

/** @param {string} message */
function log(message) {
	console.log(message);
}

/** @param {string} message */
function logHeader(message) {
	log(`\n${COLORS.BOLD}${COLORS.BLUE}${message}${COLORS.RESET}\n`);
}

/** @param {string} message */
function logSuccess(message) {
	log(`${COLORS.GREEN}✓${COLORS.RESET} ${message}`);
}

/** @param {string} message */
function logError(message) {
	log(`${COLORS.RED}✗${COLORS.RESET} ${message}`);
}

/** @param {string} message */
function logWarning(message) {
	log(`${COLORS.YELLOW}⚠${COLORS.RESET} ${message}`);
}

/** @param {string} command */
function commandExists(command) {
	try {
		const isWindows = process.platform === 'win32';
		const check = isWindows ? `where ${command}` : `command -v ${command}`;
		execSync(check, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

function checkPrerequisites() {
	logHeader('Checking prerequisites...');

	const required = ['dotnet', 'yak'];
	/** @type {string[]} */
	const missing = [];

	required.forEach((cmd) => {
		if (commandExists(cmd)) {
			try {
				const version = execSync(`${cmd} --version`, { encoding: 'utf-8' }).split('\n')[0];
				logSuccess(`${cmd}: ${version}`);
			} catch {
				logSuccess(`${cmd} found`);
			}
		} else {
			missing.push(cmd);
			logError(`${cmd} not found`);
		}
	});

	if (missing.length > 0) {
		logError(`\nMissing prerequisites: ${missing.join(', ')}`);
		process.exit(1);
	}
}

async function build() {
	try {
		logHeader('Selva Production Build');

		checkPrerequisites();

		// Step 1: Copy web assets to plugin directory
		log('[1/5] Copying web assets to plugin...');
		const webDir = join(projectRoot, 'Plugin/Selva.GH/EmbeddedAssets/web');
		const buildDir = join(projectRoot, 'packages/plugin-ui/build');

		// Verify build directory exists
		try {
			if (!statSync(buildDir).isDirectory()) {
				throw new Error(`Build directory does not exist: ${buildDir}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError(`Cannot access build directory: ${message}`);
			logWarning('Run "pnpm run build:plugin-ui" first to generate web assets');
			process.exit(1);
		}

		// Clean and recreate web directory
		try {
			if (statSync(webDir).isDirectory()) {
				rmSync(webDir, { recursive: true, force: true });
			}
		} catch {
			// Directory doesn't exist yet, that's fine
		}

		mkdirSync(webDir, { recursive: true });
		cpSync(buildDir, webDir, { recursive: true });
		logSuccess('Web assets copied to plugin');
		log('');

		// Step 2: Build C# plugin with embedded assets
		// Build the .gha project directly (not the whole solution) so the test projects
		// — which re-pull PdfSharpCore for their own use — don't get compiled against the
		// ILRepack-merged Release Selva.Drawing.dll. Compiling them in that context produces
		// duplicate-type errors because the internalized PdfSharpCore types inside
		// Selva.Drawing become visible via InternalsVisibleTo and collide with the public
		// PdfSharpCore package reference. Tests run separately in Debug.
		log('[2/5] Building C# plugin...');
		let buildOutput;
		try {
			buildOutput = execSync('dotnet build Selva.GH/Selva.GH.csproj --configuration Release', {
				cwd: join(projectRoot, 'Plugin'),
				encoding: 'utf-8',
				maxBuffer: 64 * 1024 * 1024
			});
			process.stdout.write(buildOutput);
			logSuccess('Plugin build complete');
		} catch (err) {
			const e = /** @type {{ stdout?: string, stderr?: string }} */ (err);
			if (e.stdout) process.stdout.write(e.stdout);
			if (e.stderr) process.stderr.write(e.stderr);
			logError('Plugin build failed');
			process.exit(1);
		}
		log('');

		// ILRepack logs its warnings to the console, not to MSBuild — the build exits 0
		// even when the merge corrupted a member reference. "Method reference is used
		// with definition" is the pattern behind the 0.17.1 MissingMethodException:
		// ILRepack rewrote a signature to a merged type and shipped it anyway.
		const deadlyMergePatterns = [
			'Method reference is used with definition',
			'Duplicate type '
		];
		const mergeProblems = deadlyMergePatterns.filter((p) => buildOutput.includes(p));
		if (mergeProblems.length > 0) {
			logError(`ILRepack reported a broken merge (${mergeProblems.join(', ')}) — aborting.`);
			process.exit(1);
		}

		// Step 3: Verify the merged assemblies actually bind.
		// Selva.PluginVerifier force-JITs every method of the merged output on each
		// Rhino runtime family; a corrupted merge fails here instead of inside a
		// user's Rhino. Windows-only (the verifier hosts real WinForms); release
		// builds are cut on Windows CI, macOS dev builds skip it.
		if (process.platform === 'win32') {
			log('[3/5] Verifying merged plugin assemblies...');
			try {
				execSync('dotnet build Selva.PluginVerifier/Selva.PluginVerifier.csproj --configuration Release', {
					cwd: join(projectRoot, 'Plugin'),
					stdio: 'inherit'
				});
			} catch {
				logError('Verifier build failed');
				process.exit(1);
			}

			const verifierDir = join(projectRoot, 'Plugin/Selva.PluginVerifier/bin/Release');
			const verifyLegs = [
				{ tfm: 'net48', cmd: `"${join(verifierDir, 'net48/Selva.PluginVerifier.exe')}"` },
				{ tfm: 'net7.0', cmd: `dotnet "${join(verifierDir, 'net7.0-windows/Selva.PluginVerifier.dll')}"` },
				{ tfm: 'net9.0', cmd: `dotnet "${join(verifierDir, 'net9.0-windows/Selva.PluginVerifier.dll')}"` }
			];
			for (const leg of verifyLegs) {
				const outDir = join(projectRoot, 'Plugin/Selva.GH/bin/Release', leg.tfm);
				try {
					if (!statSync(outDir).isDirectory()) continue;
				} catch {
					logWarning(`${leg.tfm} output missing, skipping verification`);
					continue;
				}
				try {
					execSync(`${leg.cmd} "${outDir}"`, { stdio: 'inherit' });
					logSuccess(`${leg.tfm}: all member references bind`);
				} catch {
					logError(`${leg.tfm}: verification FAILED — the merged plugin would break inside Rhino.`);
					process.exit(1);
				}
			}
		} else {
			logWarning('[3/5] Skipping merge verification (Windows-only step)');
		}
		log('');

		// Step 3: Stage yak packages.
		// Rhino 8 yak bundles net48 + net7.0 (both target Grasshopper 8.0.x).
		// Rhino 9 yak bundles net9.0.
		// Each TFM's output folder (containing Selva.gha and deps) is copied
		// into the yak staging dir as a TFM-named subfolder, alongside the
		// manifest and icon. `yak build` is then run in each staging dir.
		log('[4/5] Staging and building yak packages...');
		const releaseDir = join(projectRoot, 'Plugin/Selva.GH/bin/Release');
		const yakStagingRoot = join(projectRoot, 'Plugin/Selva.GH/bin/Yak');
		const resourcesDir = join(projectRoot, 'Plugin/Selva.GH/Resources');

		/** @type {{ label: string, stageDir: string, tfms: string[], manifest: string }[]} */
		const packages = [
			{
				label: 'Rhino 8',
				stageDir: join(yakStagingRoot, 'rh-8'),
				tfms: ['net48', 'net7.0'],
				manifest: join(resourcesDir, 'manifest-rh8.yml')
			},
			{
				label: 'Rhino 9',
				stageDir: join(yakStagingRoot, 'rh-9'),
				tfms: ['net9.0'],
				manifest: join(resourcesDir, 'manifest-rh9.yml')
			}
		];

		const pluginVersion = readPluginVersion();
		logSuccess(`Plugin version (from csproj): ${pluginVersion}`);

		try {
			rmSync(yakStagingRoot, { recursive: true, force: true });
		} catch {
			// not present yet
		}

		for (const pkg of packages) {
			// Verify all TFM outputs exist
			const missingTfms = pkg.tfms.filter((tfm) => {
				try {
					statSync(join(releaseDir, tfm, 'Selva.gha'));
					return false;
				} catch {
					return true;
				}
			});
			if (missingTfms.length > 0) {
				logWarning(
					`${pkg.label} missing TFM outputs: ${missingTfms.join(', ')}, skipping yak build`
				);
				continue;
			}

			mkdirSync(pkg.stageDir, { recursive: true });

			// Multi-TFM packages use TFM-named subfolders (yak convention).
			// Single-TFM packages flatten the assemblies to the staging root.
			if (pkg.tfms.length === 1) {
				cpSync(join(releaseDir, pkg.tfms[0]), pkg.stageDir, { recursive: true });
			} else {
				for (const tfm of pkg.tfms) {
					cpSync(join(releaseDir, tfm), join(pkg.stageDir, tfm), { recursive: true });
				}
			}

			// Place manifest.yml and icon.png at the staging root (overwrites any
			// manifest.yml copied in from the build output above). Substitute the
			// real version for the `$version` token so yak doesn't have to resolve
			// it by inspecting assemblies (which fails on CI for multi-TFM packages).
			const manifest = readFileSync(pkg.manifest, 'utf-8').replace(/\$version\b/g, pluginVersion);
			writeFileSync(join(pkg.stageDir, 'manifest.yml'), manifest);
			cpSync(join(resourcesDir, 'Icons', 'Icon.png'), join(pkg.stageDir, 'icon.png'));

			try {
				execSync('yak build', { cwd: pkg.stageDir, stdio: 'inherit' });
				logSuccess(`Yak package built for ${pkg.label} (${pkg.tfms.join(' + ')})`);
			} catch {
				logError(`Yak build failed for ${pkg.label}`);
				process.exit(1);
			}
		}
		log('');

		// Step 4: Display output information
		log('[5/5] Build summary:');
		log('');
		log('Yak packages:');
		for (const pkg of packages) {
			log(
				`  ${COLORS.GREEN}✓${COLORS.RESET} ${pkg.label} (${pkg.tfms.join(' + ')}): ${pkg.stageDir}`
			);
		}
		log('');
		log('Plugin binaries:');
		for (const tfm of ['net48', 'net7.0', 'net9.0']) {
			const ghaPath = join(releaseDir, tfm, 'Selva.gha');
			try {
				statSync(ghaPath);
				log(`  ${COLORS.GREEN}✓${COLORS.RESET} ${tfm}: ${ghaPath}`);
			} catch {
				logWarning(`${tfm} not found at ${ghaPath}`);
			}
		}

		log('');
		logHeader('✓ Production build complete!');
		log('Next steps:');
		log('  1. Test the plugin by copying to Grasshopper Libraries folder');
		log('  2. Restart Rhino');
		log('  3. Add UIBuilderComponent and enable it');
		log('  4. Right-click the component and select "Open UI in Browser"');
		log('');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logError(`Unexpected error: ${message}`);
		process.exit(1);
	}
}

build();
