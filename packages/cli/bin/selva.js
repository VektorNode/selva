#!/usr/bin/env node
// Operator entry: `selva <command>` dispatches to one of the commands in
// src/commands/. Linked into the deployment's node_modules/.bin/ via the
// package.json bin field, so `npm run start` / `npm run doctor` resolve here.

import pc from 'picocolors';
import { runSelva } from '../src/cli.js';

try {
	await runSelva(process.argv.slice(2));
} catch (err) {
	console.error(`${pc.red('✗')} ${err?.message ?? err}`);
	process.exit(1);
}
