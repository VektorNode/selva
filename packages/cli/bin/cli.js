#!/usr/bin/env node
// Bootstrap entry: `npx @selvajs/cli <dir>` scaffolds a fresh deployment.
// Kept as a thin shim so the real logic stays in src/ and tests can import it
// without going through process.argv.

import pc from 'picocolors';
import { runCreate } from '../src/commands/create.js';

try {
	await runCreate(process.argv.slice(2));
} catch (err) {
	console.error(`${pc.red('✗')} ${err?.message ?? err}`);
	process.exit(1);
}
