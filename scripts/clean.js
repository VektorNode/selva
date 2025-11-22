#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const examplesDir = path.join(rootDir, 'examples');

// Retry logic for Windows file locking issues
function rmDirWithRetry(dirPath, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3 });
        console.log(`✓ Deleted ${dirPath}`);
        return true;
      }
    } catch (err) {
      if (i === maxRetries - 1) {
        console.warn(`⚠ Warning: Could not fully delete ${dirPath} (${err.message})`);
        return false;
      }
      // Wait a bit before retry
      const delay = Math.min(100 * Math.pow(2, i), 1000);
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Busy wait
      }
    }
  }
  return false;
}

function rmFileWithRetry(filePath, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✓ Deleted ${filePath}`);
        return true;
      }
    } catch (err) {
      if (i === maxRetries - 1) {
        console.warn(`⚠ Warning: Could not delete ${filePath} (${err.message})`);
        return false;
      }
      const delay = Math.min(100 * Math.pow(2, i), 1000);
      const start = Date.now();
      while (Date.now() - start < delay) {
        // Busy wait
      }
    }
  }
  return false;
}

console.log('🧹 Cleaning up ComputeBuilder monorepo...\n');

// Delete root node_modules and pnpm-lock.yaml
console.log('Cleaning root directory...');
rmDirWithRetry(path.join(rootDir, 'node_modules'));
rmFileWithRetry(path.join(rootDir, 'pnpm-lock.yaml'));

// Clean packages
console.log('\nCleaning packages...');
try {
  const packages = fs.readdirSync(packagesDir);
  packages.forEach((pkg) => {
    rmDirWithRetry(path.join(packagesDir, pkg, 'node_modules'));
    rmDirWithRetry(path.join(packagesDir, pkg, '.svelte-kit'));
    rmFileWithRetry(path.join(packagesDir, pkg, 'pnpm-lock.yaml'));
  });
} catch (err) {
  console.warn('⚠ Could not read packages directory:', err.message);
}

// Clean examples
console.log('\nCleaning examples...');
try {
  const examples = fs.readdirSync(examplesDir);
  examples.forEach((ex) => {
    rmDirWithRetry(path.join(examplesDir, ex, 'node_modules'));
    rmDirWithRetry(path.join(examplesDir, ex, '.svelte-kit'));
    rmFileWithRetry(path.join(examplesDir, ex, 'pnpm-lock.yaml'));
  });
} catch (err) {
  console.warn('⚠ Could not read examples directory:', err.message);
}

console.log('\n✨ Cleanup complete!');
