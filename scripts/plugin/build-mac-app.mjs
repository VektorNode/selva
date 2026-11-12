#!/usr/bin/env node

// Builds Selva.app, the Mac counterpart of SelvaApp.exe, from Plugin/Selva.App.Mac into
// Plugin/Selva.App.Mac/bin/Selva.app. macOS only; needs the Xcode command line tools.
//
//   pnpm build:app:mac
//
// The bundle is signed ad hoc, which runs on the Mac that built it. Giving it to someone else
// needs a Developer ID signature and notarization.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logoPath, projectRoot, readPluginVersion, renderLogo } from './shared.mjs';

if (process.platform !== 'darwin') {
	console.error('Selva.app builds on macOS only.');
	process.exit(1);
}

const source = join(projectRoot, 'Plugin/Selva.App.Mac');
const bundle = join(source, 'bin/Selva.app');

const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const version = readPluginVersion();
// A bundle version is period-separated integers and nothing else: a beta's suffix would break
// LaunchServices' version comparison and fail notarization.
const bundleVersion = version.match(/^\d+(\.\d+)*/)?.[0];
if (!bundleVersion) throw new Error(`Plug-in version ${version} doesn't start with a number`);

// One slice per architecture, then joined: `swift build` takes two --arch flags only with Xcode.
const slices = ['arm64', 'x86_64'].map((arch) => {
	run('swift', ['build', '--configuration', 'release', '--arch', arch]);
	return join(source, `.build/${arch}-apple-macosx/release/Selva`);
});

rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, 'Contents/MacOS'), { recursive: true });
mkdirSync(join(bundle, 'Contents/Resources'), { recursive: true });
run('lipo', ['-create', ...slices, '-output', join(bundle, 'Contents/MacOS/Selva')]);

writeFileSync(
	join(bundle, 'Contents/Info.plist'),
	readFileSync(join(source, 'Info.plist'), 'utf-8').replaceAll('$VERSION', bundleVersion)
);
cpSync(
	join(projectRoot, 'Plugin/Selva.App/shell.html'),
	join(bundle, 'Contents/Resources/shell.html')
);
cpSync(logoPath, join(bundle, 'Contents/Resources/logo.svg'));

// A Mac icon leaves a margin around its shape: 824 of 1024 px, as Apple's icon grid draws it.
const ICON_FILL = 824 / 1024;
const iconset = join(mkdtempSync(join(tmpdir(), 'selva-icon-')), 'AppIcon.iconset');
mkdirSync(iconset);
for (const points of [16, 32, 128, 256, 512]) {
	for (const scale of [1, 2]) {
		const size = points * scale;
		const inner = Math.round(size * ICON_FILL);
		const margin = Math.floor((size - inner) / 2);
		const drawn = await renderLogo(inner);
		await drawn
			.extend({
				top: margin,
				left: margin,
				bottom: size - inner - margin,
				right: size - inner - margin,
				background: { r: 0, g: 0, b: 0, alpha: 0 }
			})
			.png()
			.toFile(join(iconset, `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`));
	}
}
run('iconutil', [
	'--convert',
	'icns',
	'--output',
	join(bundle, 'Contents/Resources/AppIcon.icns'),
	iconset
]);
rmSync(join(iconset, '..'), { recursive: true, force: true });

run('codesign', ['--force', '--sign', '-', bundle]);
console.log(`\n${bundle} (${version})`);
