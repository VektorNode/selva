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

console.log('======================================');
console.log('Selva Production Build');
console.log('======================================');
console.log('');

try {
  // Step 1: Build web application
  console.log('[1/4] Building web application...');
  execSync('pnpm --filter @selva/frontend run build', {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  console.log('✓ Web build complete');
  console.log('');

  // Step 2: Copy web assets to plugin directory
  console.log('[2/4] Copying web assets to plugin...');
  const webDir = join(projectRoot, 'Plugin/EmbeddedAssets/web');
  const buildDir = join(projectRoot, 'packages/frontend/build');

  mkdirSync(webDir, { recursive: true });
  rmSync(webDir, { recursive: true, force: true });
  mkdirSync(webDir, { recursive: true });

  if (statSync(buildDir).isDirectory()) {
    cpSync(buildDir, webDir, { recursive: true });
  }
  console.log('✓ Web assets copied');
  console.log('');

  // Step 3: Build C# plugin with embedded assets
  console.log('[3/4] Building C# plugin...');
  execSync('dotnet build --configuration Release', {
    cwd: join(projectRoot, 'Plugin'),
    stdio: 'inherit',
  });
  console.log('✓ Plugin build complete');
  console.log('');

  // Step 4: Display output information
  console.log('[4/4] Build summary:');
  console.log('');
  console.log('Output files:');
  const pluginDir = join(projectRoot, 'Plugin');
  console.log(`  - Rhino 7 (net48):  ${join(pluginDir, 'bin/Release/net48/Selva.gha')}`);
  console.log(`  - Rhino 8 (net7.0): ${join(pluginDir, 'bin/Release/net7.0/Selva.gha')}`);
  console.log('');

  console.log('======================================');
  console.log('✓ Production build complete!');
  console.log('======================================');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Test the plugin by copying to Grasshopper Libraries folder');
  console.log('  2. Restart Rhino');
  console.log('  3. Add UIBuilderComponent and enable it');
  console.log('  4. Rigt-click the component and select "Open Ui in Browser"');
  console.log('');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}
