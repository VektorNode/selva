#!/usr/bin/env node

// Follows the dev install's log (`<LocalAppData>/Selva/dev/selva.log`): everything the plugin's
// Logger writes, the bridge's message traffic, and unhandled exceptions with their stacks.
//
//   pnpm plugin:logs                       the last 40 lines, then follow
//   pnpm plugin:logs --level warn          warnings and errors only
//   pnpm plugin:logs --grep nCe74SUI       lines mentioning a session (or anything else)
//   pnpm plugin:logs --since 10m --no-follow
//   pnpm plugin:logs --json                raw lines, for jq or an agent

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { devDir } from './dev-session.mjs';

const { values } = parseArgs({
	options: {
		level: { type: 'string', default: 'trace' },
		grep: { type: 'string' },
		since: { type: 'string' },
		lines: { type: 'string', default: '40' },
		'no-follow': { type: 'boolean', default: false },
		json: { type: 'boolean', default: false }
	}
});

const LEVELS = ['trace', 'debug', 'warn', 'error'];
const minLevel = LEVELS.indexOf(values.level);
if (minLevel < 0) throw new Error(`--level is one of ${LEVELS.join(', ')}`);

const UNITS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
const since = values.since
	? Date.now() - Number(values.since.slice(0, -1)) * (UNITS[values.since.at(-1)] ?? NaN)
	: null;
if (Number.isNaN(since)) throw new Error('--since is a number and a unit: 30s, 10m, 2h, 1d');

const COLORS = { trace: '\x1b[90m', debug: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const tty = process.stdout.isTTY;

const file = join(devDir(), 'selva.log');

function show(line) {
	if (!line.trim()) return;
	let record;
	try {
		record = JSON.parse(line);
	} catch {
		return;
	}
	if (LEVELS.indexOf(record.level) < minLevel) return;
	if (since && Date.parse(record.t) < since) return;
	if (values.grep && !line.includes(values.grep)) return;
	if (values.json) return console.log(line);

	const time = record.t.slice(11, 23);
	const level = record.level.padEnd(5);
	const head = tty ? `${COLORS[record.level] ?? ''}${time} ${level}${RESET}` : `${time} ${level}`;
	console.log(`${head} ${record.msg}`);
	if (record.error) console.log(record.error.stack.replace(/^/gm, '      '));
}

if (!existsSync(file)) {
	console.error(
		`No log at ${file} yet. Install with \`pnpm install:plugin:dev\` and restart Rhino.`
	);
	if (values['no-follow']) process.exit(1);
}

let offset = 0;
if (existsSync(file)) {
	const text = readFileSync(file, 'utf8');
	const all = text.split('\n');
	// A filter reads the whole file; otherwise only the tail is worth printing.
	const filtered = values.grep || values.since || values.level !== 'trace';
	const start = filtered ? 0 : Math.max(0, all.length - 1 - Number(values.lines));
	all.slice(start).forEach(show);
	offset = Buffer.byteLength(text);
}

if (!values['no-follow']) {
	let partial = '';
	setInterval(() => {
		if (!existsSync(file)) return;
		const size = statSync(file).size;
		// The plugin rolled the file to selva.log.1 and started again.
		if (size < offset) offset = 0;
		if (size === offset) return;
		const buffer = Buffer.alloc(size - offset);
		const fd = openSync(file, 'r');
		readSync(fd, buffer, 0, buffer.length, offset);
		closeSync(fd);
		offset = size;
		const lines = (partial + buffer.toString('utf8')).split('\n');
		partial = lines.pop();
		lines.forEach(show);
	}, 250);
}
