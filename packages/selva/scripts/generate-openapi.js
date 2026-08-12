#!/usr/bin/env node
/**
 * Regenerates `openapi/v1.yaml`.
 *
 * The conformance test owns both halves of the contract: it writes the spec
 * when `UPDATE_OPENAPI` is set and fails when the committed file has drifted
 * otherwise. This wrapper runs that test through vitest instead of a separate
 * generator, so it keeps vitest's module resolution (`$lib`, the workspace
 * `source` condition) rather than a second, subtly different one.
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
