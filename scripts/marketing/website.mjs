#!/usr/bin/env node

// Copies the captures the website's landing page shows from marketing/ into
// packages/website/static/showcase/, at web sizes: .webp stills, and 900p .mp4 loops with a poster.
//
//   node scripts/marketing/website.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { outRoot, root } from './lib.mjs';

const target = path.join(root, 'packages/website/static/showcase');

// name → capture
const videos = {
	kitchen: 'plugin/kitchen-run/preview-tour.mp4',
	shelving: 'plugin/shelving-unit/preview-tour.mp4',
	lamp: 'plugin/studio-task-lamp/preview-tour.mp4',
	massing: 'plugin/block-massing-studio/preview-tour.mp4',
	garden: 'plugin/garden-sketch/preview-tour.mp4',
	builder: 'plugin/kitchen-run/builder-tour.mp4'
};

// name → [capture, width in px, crop of the capture as ffmpeg's w:h:x:y]
const stills = {
	canvas: ['grasshopper/kitchen-run/canvas.png', 2000],
	'ui-bridge': ['grasshopper/kitchen-run/group-ui-bridge.png', 1200],
	'rhino-docked': ['rhino/kitchen-panel-docked.png', 1600],
	'rhino-window': ['rhino/kitchen-own-window.png', 1600],
	'look-showcase': ['plugin/kitchen-run/view-showcase.png', 900],
	'look-arctic': ['plugin/kitchen-run/view-arctic.png', 900],
	'look-line-art': ['plugin/kitchen-run/view-line-art.png', 900],
	'look-night': ['plugin/kitchen-run/view-night.png', 900],
	phone: ['plugin/kitchen-run/preview-phone.png', 600],
	'team-members': ['app/dark/team-members.png', 1600],
	// Shown at half width: cropped to the page's content, or the text is too small to read.
	'team-projects': ['app/dark/team-projects.png', 1600, '2320:1305:680:130'],
	'team-tokens': ['app/dark/team-tokens.png', 1600, '2320:1305:680:1010']
};

function ffmpeg(args) {
	const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
	if (run.status !== 0) throw new Error(`ffmpeg failed on ${args.at(-1)}`);
}

function report(file) {
	const kb = Math.round(fs.statSync(file).size / 1024);
	console.info(`${path.relative(root, file)}  ${kb} kB`);
}

fs.mkdirSync(target, { recursive: true });

for (const [name, capture] of Object.entries(videos)) {
	const source = path.join(outRoot, capture);
	const video = path.join(target, `${name}.mp4`);
	ffmpeg([
		'-i',
		source,
		'-vf',
		'scale=1600:-2:flags=lanczos,format=yuv420p',
		'-c:v',
		'libx264',
		'-crf',
		'24',
		'-preset',
		'slow',
		'-an',
		'-movflags',
		'+faststart',
		video
	]);
	report(video);

	// The first frame, so the picture doesn't jump when the loop starts.
	const poster = path.join(target, `${name}.webp`);
	ffmpeg(['-i', video, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', poster]);
	report(poster);
}

for (const [name, [capture, width, crop]] of Object.entries(stills)) {
	const file = path.join(target, `${name}.webp`);
	ffmpeg([
		'-i',
		path.join(outRoot, capture),
		'-vf',
		`${crop ? `crop=${crop},` : ''}scale=${width}:-2:flags=lanczos`,
		'-c:v',
		'libwebp',
		'-quality',
		'84',
		file
	]);
	report(file);
}
