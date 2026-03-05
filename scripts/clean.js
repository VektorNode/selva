#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const examplesDir = path.join(rootDir, 'examples');

const DRY_RUN = process.argv.includes('--dry-run');
const MAX_RETRIES = 5;

// Helper for async delay
/** @param {number} ms */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry logic with proper async delay for Windows file locking issues
/** @param {string} dirPath */
async function rmDirWithRetry(dirPath) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (!fs.existsSync(dirPath)) {
        return true; // Already gone
      }

      if (DRY_RUN) {
        console.log(`  (dry-run) Would delete: ${dirPath}`);
        return true;
      }

      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3 });
      console.log(`✓ Deleted ${dirPath}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (i === MAX_RETRIES - 1) {
        console.warn(`⚠ Warning: Could not delete ${dirPath} (${message})`);
        return false;
      }
      const delay = Math.min(100 * Math.pow(2, i), 1000);
      await sleep(delay);
    }
  }
  return false;
}

/** @param {string} filePath */
async function rmFileWithRetry(filePath) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      if (!fs.existsSync(filePath)) {
        return true; // Already gone
      }

      if (DRY_RUN) {
        console.log(`  (dry-run) Would delete: ${filePath}`);
        return true;
      }

      fs.unlinkSync(filePath);
      console.log(`✓ Deleted ${filePath}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (i === MAX_RETRIES - 1) {
        console.warn(`⚠ Warning: Could not delete ${filePath} (${message})`);
        return false;
      }
      const delay = Math.min(100 * Math.pow(2, i), 1000);
      await sleep(delay);
    }
  }
  return false;
}

// Validate directory structure
function validateDirs() {
  const requiredDirs = [
    { path: rootDir, name: 'root' },
    { path: packagesDir, name: 'packages' },
  ];

  const missingDirs = requiredDirs.filter(dir => !fs.existsSync(dir.path));

  if (missingDirs.length > 0) {
    console.error('❌ Error: Expected directories not found:');
    missingDirs.forEach(dir => console.error(`   - ${dir.name} (${dir.path})`));
    process.exit(1);
  }
}

// Main cleanup function
async function cleanup() {
  validateDirs();

  if (DRY_RUN) {
    console.log('🧹 Cleaning up Selva monorepo (DRY RUN)...\n');
  } else {
    console.log('🧹 Cleaning up Selva monorepo...\n');
  }

  // Clean root directory
  console.log('Cleaning root directory...');
  await rmDirWithRetry(path.join(rootDir, 'node_modules'));
  await rmFileWithRetry(path.join(rootDir, 'pnpm-lock.yaml'));

  // Clean packages
  console.log('\nCleaning packages...');
  try {
    if (fs.existsSync(packagesDir)) {
      const packages = fs.readdirSync(packagesDir);
      for (const pkg of packages) {
        await rmDirWithRetry(path.join(packagesDir, pkg, 'node_modules'));
        await rmDirWithRetry(path.join(packagesDir, pkg, '.svelte-kit'));
        await rmFileWithRetry(path.join(packagesDir, pkg, 'pnpm-lock.yaml'));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Could not read packages directory:', message);
  }

  // Clean examples (optional directory)
  if (fs.existsSync(examplesDir)) {
    console.log('\nCleaning examples...');
    try {
      const examples = fs.readdirSync(examplesDir);
      for (const ex of examples) {
        await rmDirWithRetry(path.join(examplesDir, ex, 'node_modules'));
        await rmDirWithRetry(path.join(examplesDir, ex, '.svelte-kit'));
        await rmFileWithRetry(path.join(examplesDir, ex, 'pnpm-lock.yaml'));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('⚠ Could not read examples directory:', message);
    }
  }

  console.log('\n✨ Cleanup complete!');
  if (DRY_RUN) {
    console.log('(Run without --dry-run to actually delete files)');
  }
}

cleanup().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
