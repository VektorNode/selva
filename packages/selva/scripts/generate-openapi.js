#!/usr/bin/env node
/**
 * Regenerates `openapi/v1.yaml`.
 *
 * The document is actually built inside the conformance test, which owns both
 * halves of the contract: it writes the spec when `UPDATE_OPENAPI` is set and
 * fails when the committed file has drifted otherwise. This wrapper exists so
 * that regenerating is a named command rather than an env var someone has to
 * remember, and so the generator keeps vitest's module resolution — `$lib` and
 * the workspace `source` condition — instead of a second, subtly different one.
 */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync(
	'npx',
	['vitest', 'run', 'src/lib/server/api/v1/__tests__/conformance.test.ts'],
	{
		cwd: packageRoot,
		env: { ...process.env, UPDATE_OPENAPI: '1' },
		stdio: 'inherit',
		shell: process.platform === 'win32'
	}
);

process.exit(result.status ?? 1);
