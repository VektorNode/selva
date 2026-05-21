#!/usr/bin/env node
import { runCreate } from '../src/commands/create.js';

runCreate(process.argv.slice(2)).catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
