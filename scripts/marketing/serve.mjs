#!/usr/bin/env node

// The Selva app on its own throwaway data, for app.mjs to fill and photograph: local providers,
// multi-tenant, sharing on, port 5373. Beside `pnpm dev:local`, whose data it never touches.
//
//   node scripts/marketing/serve.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';

import { root } from './lib.mjs';

const child = spawn(
	'pnpm',
	[
		'--filter',
		'@selvajs/selva',
		'exec',
		'vite',
		'dev',
		'--mode',
		'dev-local',
		'--port',
		'5373',
		'--strictPort'
	],
	{
		cwd: root,
		stdio: 'inherit',
		// pnpm is a .cmd shim on Windows, which Node only spawns through a shell.
		shell: process.platform === 'win32',
		env: {
			...process.env,
			SELVA_AUTH_PROVIDER: 'local',
			SELVA_DATA_PROVIDER: 'local',
			SELVA_STORAGE_PROVIDER: 'local',
			SELVA_TENANCY: 'multi',
			SELVA_BRAND_NAME: 'Selva',
			SELVA_FLAG_ENABLE_SHARING: 'true',
			// Setup only admits this address; it is the owner app.mjs claims the instance as.
			BOOTSTRAP_INSTANCE_ADMIN_EMAIL: 'mara@northfold.example',
			DATA_PATH: path.join(root, '.selva-data', 'marketing')
		}
	}
);
child.on('exit', (code) => process.exit(code ?? 0));
