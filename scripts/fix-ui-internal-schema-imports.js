#!/usr/bin/env node
// One-shot: redirect ui's internal $lib/types/generated and ../../types/generated
// imports to @selvajs/schemas. Safe to delete after PR 2 is committed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const files = [
  'packages/ui/src/lib/components/app-shell/AppLayout.svelte',
  'packages/ui/src/lib/components/app-shell/CollapsedPanelStrip.svelte',
  'packages/ui/src/lib/components/app-shell/ComputeApp.svelte',
  'packages/ui/src/lib/components/app-shell/ParameterPresetManager.svelte',
  'packages/ui/src/lib/components/preview/ChartOutput.svelte',
  'packages/ui/src/lib/components/preview/Group.svelte',
  'packages/ui/src/lib/components/preview/InputControl.svelte',
  'packages/ui/src/lib/components/preview/inputs/CheckboxInput.svelte',
  'packages/ui/src/lib/components/preview/inputs/DropdownInput.svelte',
  'packages/ui/src/lib/components/preview/inputs/NumberInput.svelte',
  'packages/ui/src/lib/components/preview/inputs/TextInput.svelte',
  'packages/ui/src/lib/components/preview/OutputDisplay.svelte',
  'packages/ui/src/lib/components/preview/TabBar.svelte',
  'packages/ui/src/lib/components/preview/TabContent.svelte',
  'packages/ui/src/lib/components/preview/TabLayout.svelte',
  'packages/ui/src/lib/utils/param-exporter.ts',
  'packages/ui/src/lib/utils/visibility-rules.ts',
  'packages/ui/src/routes/+page.svelte',
];

const patterns = [
  [/from '\$lib\/types\/generated'/g, "from '@selvajs/schemas'"],
  [/from '\.\.\/types\/generated'/g, "from '@selvajs/schemas'"],
  [/from '\.\.\/\.\.\/types\/generated'/g, "from '@selvajs/schemas'"],
];

let changed = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  let c = fs.readFileSync(abs, 'utf8');
  const before = c;
  for (const [re, repl] of patterns) {
    c = c.replace(re, repl);
  }
  if (c !== before) {
    fs.writeFileSync(abs, c, 'utf8');
    console.log('updated:', rel);
    changed++;
  }
}
console.log(`\n${changed} files updated`);
