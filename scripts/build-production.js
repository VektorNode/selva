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
  BLUE: '\x1b[34m',
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

  required.forEach(cmd => {
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
        stdio: 'inherit',
      });
      logSuccess('Plugin build complete');
    } catch {
      logError('Plugin build failed');
      process.exit(1);
    }
    log('');

    // Step 3: Build a separate yak package per target framework
    // manifest.yml and icon.png are copied to each TFM output folder by the csproj.
    log('[3/4] Running yak build for each target framework...');
    const releaseDir = join(projectRoot, 'Plugin/Selva.GH/bin/Release');
    const targets = [
      { tfm: 'net7.0', label: 'Rhino 8' },
      { tfm: 'net9.0', label: 'Rhino 9' },
    ];

    for (const { tfm, label } of targets) {
      const tfmDir = join(releaseDir, tfm);
      try {
        statSync(tfmDir);
      } catch {
        logWarning(`${label} (${tfm}) output folder not found at ${tfmDir}, skipping yak build`);
        continue;
      }

      try {
        execSync('yak build', { cwd: tfmDir, stdio: 'inherit' });
        logSuccess(`Yak package built for ${label} (${tfm})`);
      } catch {
        logError(`Yak build failed for ${label} (${tfm})`);
        process.exit(1);
      }
    }
    log('');

    // Step 4: Display output information
    log('[4/4] Build summary:');
    log('');
    log('Output files:');
    for (const { tfm, label } of targets) {
      const ghaPath = join(releaseDir, tfm, 'Selva.gha');
      try {
        statSync(ghaPath);
        log(`  ${COLORS.GREEN}✓${COLORS.RESET} ${label} (${tfm}): ${ghaPath}`);
      } catch {
        logWarning(`${label} (${tfm}) not found at ${ghaPath}`);
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
