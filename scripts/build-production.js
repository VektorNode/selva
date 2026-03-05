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
    execSync(`command -v ${command}`, { stdio: 'ignore', shell: '/bin/bash' });
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

    // Step 3: Run yak build in the release folder
    log('[3/4] Running yak build...');
    const releaseDir = join(projectRoot, 'Plugin/Selva.GH/bin/Release');
    try {
      execSync('yak build', {
        cwd: releaseDir,
        stdio: 'inherit',
      });
      logSuccess('Yak package built');
    } catch {
      logError('Yak build failed');
      process.exit(1);
    }
    log('');

    // Step 4: Display output information
    log('[4/4] Build summary:');
    log('');
    log('Output files:');
    const pluginDir = join(projectRoot, 'Plugin');
    const net48Path = join(pluginDir, 'bin/Release/net48/Selva.gha');
    const net7Path = join(pluginDir, 'bin/Release/net7.0/Selva.gha');

    try {
      statSync(net48Path);
      log(`  ${COLORS.GREEN}✓${COLORS.RESET} Rhino 7 (net48):  ${net48Path}`);
    } catch {
      logWarning(`Rhino 7 (net48) not found at ${net48Path}`);
    }

    try {
      statSync(net7Path);
      log(`  ${COLORS.GREEN}✓${COLORS.RESET} Rhino 8 (net7.0): ${net7Path}`);
    } catch {
      logWarning(`Rhino 8 (net7.0) not found at ${net7Path}`);
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
