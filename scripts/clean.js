#!/usr/bin/env node

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

const DRY_RUN = process.argv.includes('--dry-run');
const FAST = process.argv.includes('--fast');
const FOREGROUND = process.argv.includes('--foreground');
const IS_WINDOWS = process.platform === 'win32';

const TRASH_PREFIX = '.trash-';

/**
 * Start a heartbeat dot-printer. Returns a stop function.
 * @param {string} label
 */
function startHeartbeat(label) {
  process.stdout.write(label);
  const timer = setInterval(() => process.stdout.write('.'), 2000);
  return () => {
    clearInterval(timer);
    process.stdout.write('\n');
  };
}

/**
 * Shell out to the OS's native recursive delete. Much faster than Node's rm
 * for pnpm's symlink-heavy node_modules on Windows.
 * @param {string} dirPath
 */
function nativeRmDir(dirPath) {
  return /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      const cmd = IS_WINDOWS ? 'cmd.exe' : 'rm';
      const args = IS_WINDOWS ? ['/c', 'rd', '/s', '/q', dirPath] : ['-rf', dirPath];
      const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
      child.on('error', reject);
      child.on('exit', code => {
        // rd returns non-zero if the dir was already gone; treat that as success
        if (code === 0 || !fs.existsSync(dirPath)) resolve();
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    })
  );
}

/**
 * Rename a directory to a sibling trash name so it's "gone" instantly,
 * then delete the trash folder. In background mode, the delete is detached
 * and the script returns immediately.
 * @param {string} dirPath
 */
async function rmDirFast(dirPath) {
  if (!fs.existsSync(dirPath)) return true;

  if (DRY_RUN) {
    console.log(`  (dry-run) Would delete: ${dirPath}`);
    return true;
  }

  const trashPath = path.join(
    path.dirname(dirPath),
    `${TRASH_PREFIX}${path.basename(dirPath)}-${Date.now()}`
  );

  // Step 1: rename (near-instant, even for huge trees)
  try {
    await fsp.rename(dirPath, trashPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ Rename failed for ${dirPath} (${message}), falling back to direct delete`);
    return deleteDirect(dirPath);
  }

  console.log(`✓ Moved to trash: ${dirPath}`);

  // Step 2: delete the trash folder (can be backgrounded)
  if (FOREGROUND) {
    const stop = startHeartbeat(`  Deleting ${path.basename(trashPath)}`);
    try {
      await deleteDirect(trashPath);
    } finally {
      stop();
    }
  } else {
    // Fire and forget; errors are logged but don't block the script
    deleteDirect(trashPath).catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ Background delete of ${trashPath} failed: ${message}`);
    });
  }

  return true;
}

/**
 * Do the actual recursive delete. On Windows, native `rd /s /q` handles busy
 * files and long paths far better than fs.promises.rm, so we prefer it.
 * @param {string} dirPath
 */
async function deleteDirect(dirPath) {
  if (!fs.existsSync(dirPath)) return true;
  try {
    if (FAST || IS_WINDOWS) {
      await nativeRmDir(dirPath);
    } else {
      await fsp.rm(dirPath, { recursive: true, force: true, maxRetries: 3 });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ Warning: Could not delete ${dirPath} (${message})`);
    return false;
  }
}

/** @param {string} filePath */
async function rmFile(filePath) {
  if (!fs.existsSync(filePath)) return true;
  if (DRY_RUN) {
    console.log(`  (dry-run) Would delete: ${filePath}`);
    return true;
  }
  try {
    await fsp.unlink(filePath);
    console.log(`✓ Deleted ${filePath}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`⚠ Warning: Could not delete ${filePath} (${message})`);
    return false;
  }
}

/**
 * Sweep any leftover .trash-* folders from previous runs.
 * @param {string} parentDir
 */
async function sweepTrash(parentDir) {
  if (!fs.existsSync(parentDir)) return;
  try {
    const entries = await fsp.readdir(parentDir);
    const trashEntries = entries.filter(e => e.startsWith(TRASH_PREFIX));
    for (const entry of trashEntries) {
      const trashPath = path.join(parentDir, entry);
      if (DRY_RUN) {
        console.log(`  (dry-run) Would sweep: ${trashPath}`);
        continue;
      }
      deleteDirect(trashPath).catch(() => {});
    }
  } catch {
    // ignore
  }
}

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

async function cleanup() {
  validateDirs();

  if (DRY_RUN) console.log('🧹 Cleaning up Selva monorepo (DRY RUN)...\n');
  else console.log('🧹 Cleaning up Selva monorepo...\n');

  if (FAST) console.log('⚡ Fast mode: using native OS delete');
  if (FOREGROUND) console.log('⏳ Foreground mode: waiting for deletes to finish');
  console.log();

  // Sweep any leftover trash from previous runs (best effort, backgrounded).
  // rmDirFast trashes next to the deleted dir, so package dirs need sweeping too.
  await sweepTrash(rootDir);
  if (fs.existsSync(packagesDir)) {
    for (const pkg of await fsp.readdir(packagesDir)) {
      await sweepTrash(path.join(packagesDir, pkg));
    }
  }

  // Clean root
  console.log('Cleaning root directory...');
  await rmDirFast(path.join(rootDir, 'node_modules'));
  await rmFile(path.join(rootDir, 'pnpm-lock.yaml'));

  // Clean packages
  console.log('\nCleaning packages...');
  try {
    if (fs.existsSync(packagesDir)) {
      const packages = await fsp.readdir(packagesDir);
      for (const pkg of packages) {
        if (pkg.startsWith(TRASH_PREFIX)) continue;
        await rmDirFast(path.join(packagesDir, pkg, 'node_modules'));
        await rmDirFast(path.join(packagesDir, pkg, '.svelte-kit'));
        await rmFile(path.join(packagesDir, pkg, 'pnpm-lock.yaml'));
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('⚠ Could not read packages directory:', message);
  }

  console.log('\n✨ Cleanup complete!');
  if (!FOREGROUND && !DRY_RUN) {
    console.log('   (Trash folders are being deleted in the background — safe to run pnpm install now)');
  }
  if (DRY_RUN) {
    console.log('   (Run without --dry-run to actually delete files)');
  }
}

cleanup().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
