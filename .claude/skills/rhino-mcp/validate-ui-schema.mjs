#!/usr/bin/env node
// Validate a UI schema payload against packages/schemas/ui-schema.json.
//
//   node scripts/validate-ui-schema.mjs <file.json> [...]
//
// Written for schemas authored by hand or by an agent — the designer produces
// valid output on its own. Catches the failures that are otherwise silent:
// Newtonsoft binds enums case-insensitively and ignores unknown keys, so a
// grafted schema with "Number" instead of "number", or layout items parked on
// a tab instead of a group, deserializes without complaint and simply loses
// the content.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// .claude/skills/rhino-mcp/ -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// ajv is only present transitively (no package here declares it), so resolve it
// out of the pnpm store rather than adding a dependency for a dev-only script.
let Ajv;
try {
	Ajv = require('ajv');
} catch {
	const store = resolve(repoRoot, 'node_modules/.pnpm');
	const found = existsSync(store) && readdirSync(store).find((d) => d.startsWith('ajv@'));
	if (!found) {
		console.error('ajv not found. Run `pnpm install` at the repo root.');
		process.exit(2);
	}
	Ajv = require(resolve(store, found, 'node_modules/ajv'));
}

const schema = require(resolve(repoRoot, 'packages/schemas/ui-schema.json'));

// validateSchema:false — ui-schema.json carries a "//_COMMENT" string key in
// definitions that ajv rejects as a meta-schema violation. Harmless for codegen
// and for validating instances.
const ajv = new Ajv({ allErrors: true, validateSchema: false });

// ui-schema.json uses "guid" (the NJsonSchema/.NET spelling). ajv 6 only knows
// "uuid", so without this every payload dies at compile time, not validation.
ajv.addFormat('guid', /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);

const validate = ajv.compile(schema);

const files = process.argv.slice(2);
if (files.length === 0) {
	console.error('usage: node scripts/validate-ui-schema.mjs <file.json> [...]');
	process.exit(2);
}

let failed = 0;
for (const file of files) {
	let payload;
	try {
		payload = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		console.error(`✗ ${file}\n    unreadable: ${err.message}`);
		failed++;
		continue;
	}

	// Fixture payloads carry a placeholder documentId that is filled in against
	// the live GH document; don't fail them on it.
	if (typeof payload.documentId === 'string' && payload.documentId.startsWith('<')) {
		payload = { ...payload, documentId: '00000000-0000-0000-0000-000000000000' };
	}

	if (validate(payload)) {
		// eslint-disable-next-line no-console -- CLI success line belongs on stdout, not stderr
		console.log(`✓ ${file}`);
		continue;
	}

	failed++;
	console.error(`✗ ${file}`);
	for (const e of validate.errors) {
		console.error(`    ${e.dataPath || '(root)'} ${e.message}`);
	}
}

process.exit(failed > 0 ? 1 : 0);
