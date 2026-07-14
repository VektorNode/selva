#!/usr/bin/env node

// Copies canonical binary assets from assets/shared/ into each consuming
// package's static/ dir. SvelteKit/Vite only serve files physically present
// under static/, so a symlink-free copy step is required per package.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sharedDir = path.join(rootDir, 'assets', 'shared');

/** @type {Record<string, string[]>} */
const MANIFEST = {
  'baseHDR.hdr': ['packages/plugin-ui/static', 'packages/ui/static'],
};

function syncAsset(assetName, targetDirs) {
  const src = path.join(sharedDir, assetName);
  if (!fs.existsSync(src)) {
    console.error(`✗ Missing shared asset: ${src}`);
    process.exitCode = 1;
    return;
  }

  for (const relDir of targetDirs) {
    const destDir = path.join(rootDir, relDir);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, assetName);
    fs.copyFileSync(src, dest);
    console.log(`✓ ${relDir}/${assetName}`);
  }
}

for (const [asset, targets] of Object.entries(MANIFEST)) {
  syncAsset(asset, targets);
}
