#!/usr/bin/env node
// One-shot: split `@selvajs/ui` imports — schema symbols move to `@selvajs/schemas`.
// Safe to delete after the split is committed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');

// Symbols that moved to @selvajs/schemas. Anything not in this set stays in @selvajs/ui.
const SCHEMA_SYMBOLS = new Set([
  // Types from schema.ts
  'UISchema', 'LayoutItem', 'LayoutItemBase', 'LayoutConfig',
  'TabbedLayoutConfig', 'FlatLayoutConfig', 'TabConfig', 'GroupConfig',
  'LineBreakLayoutItem',
  'InputNumberLayoutItem', 'InputTextLayoutItem', 'InputDropdownLayoutItem',
  'InputCheckboxLayoutItem', 'InputFileLayoutItem', 'InputColorLayoutItem',
  'OutputTextLayoutItem', 'OutputNumberLayoutItem', 'OutputFileLayoutItem',
  'OutputChartLayoutItem',
  'InputLayoutItem', 'OutputLayoutItem', 'SupportedTypes',
  'SelvaUISchema',
  'VisibilityRule', 'VisibilityCondition', 'GroupVisibilityCondition',
  'NumberWidgetConfig', 'TextWidgetConfig', 'DropdownWidgetConfig',
  'CheckboxWidgetConfig', 'FileWidgetConfig', 'FileInputWidgetConfig',
  'ColorWidgetConfig', 'ChartWidgetConfig',
  'DiscoveredInput', 'DiscoveredOutput', 'DiscoveredParameters',
  'SchemaInput', 'SchemaOutput',
  'ViewerOptions', 'ViewerOptions1',
  'SessionState', 'RuntimeValues', 'ValidationIssueMessage',
  'GrasshopperParamType', 'GrasshopperInputStructure',
  // From preset.ts
  'ParameterPreset', 'ParameterState', 'SelvaParameterPresetSchema',
  // Constants
  'ACCEPTED_FILE_FORMATS',
  // Type guards
  'isInputLayoutItem', 'isOutputLayoutItem', 'isLineBreakLayoutItem',
  'isNumberWidget', 'isTextWidget', 'isDropdownWidget',
  'isCheckboxWidget', 'isFileWidget', 'isColorWidget',
]);

const exts = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.svelte']);
const skipDirs = new Set([
  'node_modules', '.git', '.svelte-kit', 'dist', 'build', '.turbo',
  '.changeset', 'coverage', '.next', '.cache',
  'EmbeddedAssets', 'bin', 'obj',
]);
const skipFiles = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
  'split-ui-schemas-imports.js', 'rename-shared-to-ui.js', 'rename-packages.js',
]);

let filesScanned = 0;
let filesChanged = 0;

// Match a full import statement (single- or multi-line) from '@selvajs/ui'.
// Captures: leading whitespace, optional 'type' keyword, brace contents.
// Brace body cannot contain `{` or `}` (no nested braces in import specifier lists).
// We DON'T touch default imports or namespace imports.
const IMPORT_RE = /(^[ \t]*import\s+(type\s+)?\{)([^{}]*?)(\}\s*from\s+['"]@selvajs\/ui['"]\s*;?)/gm;

// Within a brace block, parse comma-separated specifiers. Each specifier is
//   Name | Name as Alias | type Name | type Name as Alias
// We treat it generally and re-emit as-is.
function splitSpecifiers(braceBody) {
  // Strip whitespace/newlines, split on commas
  const raw = braceBody.split(',').map(s => s.trim()).filter(Boolean);
  return raw;
}

function specifierKey(spec) {
  // Strip leading "type " if present, then take the original (left-of-as) name
  const noType = spec.replace(/^type\s+/, '').trim();
  const name = noType.split(/\s+as\s+/)[0].trim();
  return name;
}

function rewriteFile(content) {
  let result = '';
  let lastIndex = 0;
  let changed = false;

  for (const match of content.matchAll(IMPORT_RE)) {
    const [full, prefix, typeKw, body, suffix] = match;
    const start = match.index;
    const end = start + full.length;

    // Append text before this import unchanged
    result += content.slice(lastIndex, start);
    lastIndex = end;

    const specs = splitSpecifiers(body);
    const uiSpecs = [];
    const schemaSpecs = [];
    for (const spec of specs) {
      const key = specifierKey(spec);
      if (SCHEMA_SYMBOLS.has(key)) {
        schemaSpecs.push(spec);
      } else {
        uiSpecs.push(spec);
      }
    }

    if (schemaSpecs.length === 0) {
      // No schema symbols — leave import as-is
      result += full;
      continue;
    }

    changed = true;

    // Indent based on what was before "import"
    const lineStart = content.lastIndexOf('\n', start) + 1;
    const indent = content.slice(lineStart, start);

    // Rebuild imports. If all specs were schema symbols, we drop the @selvajs/ui import.
    const isType = !!typeKw;
    const newImports = [];

    if (uiSpecs.length > 0) {
      newImports.push(`${indent}import ${isType ? 'type ' : ''}{ ${uiSpecs.join(', ')} } from '@selvajs/ui';`);
    }

    // Schemas import: if the original was `import type`, keep it as type import.
    // Otherwise emit non-type import (keeps runtime constants like ACCEPTED_FILE_FORMATS working).
    // Edge case: if all schema specs are type-only AND original wasn't `type`, we still emit non-type
    // to be safe — `import type` of a value is a TS error.
    newImports.push(`${indent}import ${isType ? 'type ' : ''}{ ${schemaSpecs.join(', ')} } from '@selvajs/schemas';`);

    result += newImports.join('\n');
  }

  result += content.slice(lastIndex);
  return changed ? result : null;
}

function processFile(filePath) {
  const ext = path.extname(filePath);
  if (!exts.has(ext)) return;
  if (skipFiles.has(path.basename(filePath))) return;
  filesScanned++;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  if (!content.includes('@selvajs/ui')) return;

  const updated = rewriteFile(content);
  if (updated === null) return;

  filesChanged++;
  if (DRY_RUN) {
    console.log(`would change: ${path.relative(rootDir, filePath)}`);
  } else {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`changed: ${path.relative(rootDir, filePath)}`);
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

console.log(DRY_RUN ? '=== DRY RUN ===' : '=== APPLYING SPLIT ===');
walk(rootDir);
console.log('');
console.log(`Scanned ${filesScanned} files`);
console.log(`Changed ${filesChanged} files`);
