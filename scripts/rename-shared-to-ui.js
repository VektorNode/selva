#!/usr/bin/env node
// One-shot rename: @selvajs/shared -> @selvajs/ui (PR 1).
// Adapted from rename-packages.js. Safe to delete after the rename is committed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');

const replacements = [
  ['@selvajs/shared', '@selvajs/ui'],
];

const exts = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.svelte',
  '.json', '.jsonc',
  '.md', '.mdx',
  '.yml', '.yaml', '.toml',
  '.sql', '.css',
  '.cs',
  '.html'
]);

const skipDirs = new Set([
  'node_modules', '.git', '.svelte-kit', 'dist', 'build', '.turbo',
  '.changeset',
  'coverage', '.next', '.cache',
  'EmbeddedAssets',
  'bin', 'obj',
]);

const skipFiles = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'rename-shared-to-ui.js',
  'rename-packages.js',
]);

let filesScanned = 0;
let filesChanged = 0;
let totalReplacements = 0;

function shouldSkipPath(p) {
  return skipFiles.has(path.basename(p));
}

function processFile(filePath) {
  const ext = path.extname(filePath);
  if (!exts.has(ext)) return;
  if (shouldSkipPath(filePath)) return;
  filesScanned++;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  let updated = content;
  let fileReps = 0;

  for (const [oldName, newName] of replacements) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(?<![A-Za-z0-9_\\-/@])${escaped}(?![A-Za-z0-9_\\-])`,
      'g'
    );
    const before = updated;
    updated = updated.replace(pattern, newName);
    if (updated !== before) {
      const matches = before.match(pattern);
      fileReps += matches ? matches.length : 0;
    }
  }

  if (updated !== content) {
    filesChanged++;
    totalReplacements += fileReps;
    if (DRY_RUN) {
      console.log(`would change (${fileReps}): ${path.relative(rootDir, filePath)}`);
    } else {
      fs.writeFileSync(filePath, updated, 'utf8');
      console.log(`changed (${fileReps}): ${path.relative(rootDir, filePath)}`);
    }
  }
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(full);
    } else if (entry.isFile()) {
      processFile(full);
    }
  }
}

console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING RENAME ===');
walk(rootDir);
console.log('');
console.log(`Scanned ${filesScanned} files`);
console.log(`Changed ${filesChanged} files`);
console.log(`Total replacements: ${totalReplacements}`);
