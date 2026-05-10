#!/usr/bin/env node

/**
 * Production build script for Selva
 * Builds web assets and embeds them into the Grasshopper plugin
 * Cross-platform compatible (Windows, macOS, Linux)
 */

import { execSync } from 'child_process';
import { rmSync, cpSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = join(__dirname, '..');

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
		log('[1/4] Copying web assets to plugin...');
		const webDir = join(projectRoot, 'Plugin/Selva.GH/EmbeddedAssets/web');
		const buildDir = join(projectRoot, 'packages/builder-app/build');

		// Verify build directory exists
		try {
			if (!statSync(buildDir).isDirectory()) {
				throw new Error(`Build directory does not exist: ${buildDir}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError(`Cannot access build directory: ${message}`);
			logWarning('Run "pnpm run build:builder" first to generate web assets');
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
		log('[2/4] Building C# plugin...');
		try {
			execSync('dotnet build --configuration Release', {
				cwd: join(projectRoot, 'Plugin'),
				stdio: 'inherit'
			});
			logSuccess('Plugin build complete');
		} catch {
			logError('Plugin build failed');
			process.exit(1);
		}
		log('');

		// Step 3: Stage yak packages.
		// Rhino 8 yak bundles net48 + net7.0 (both target Grasshopper 8.0.x).
		// Rhino 9 yak bundles net9.0.
		// Each TFM's output folder (containing Selva.gha and deps) is copied
		// into the yak staging dir as a TFM-named subfolder, alongside the
		// manifest and icon. `yak build` is then run in each staging dir.
		log('[3/4] Staging and building yak packages...');
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
			// manifest.yml copied in from the build output above).
			cpSync(pkg.manifest, join(pkg.stageDir, 'manifest.yml'));
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
		log('[4/4] Build summary:');
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
