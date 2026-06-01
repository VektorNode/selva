import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// E2E tests run against the production build served by adapter-node — the same
// `node build/index.js` entrypoint a deployment uses. This avoids the dev
// server's git/define plumbing and exercises the real server pipeline.
//
// The local provider is the only stack with no external dependency (no Rhino
// .Compute, no Supabase), so smoke tests run it with throwaway keys and a temp
// DATA_PATH under .e2e/. Compute-dependent flows should stub the upstream
// rather than point at a live server.
//
// Projects:
//   • setup    — drives the real /setup form once, creating the admin and
//                saving its session to storageState (see e2e/.auth/admin.json).
//   • smoke    — unauthenticated public surface (no storageState).
//   • authed   — reuses the admin session; depends on `setup`.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.E2E_PORT ?? 4173);
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

const ADMIN_STATE = path.join(__dirname, 'e2e/.auth/admin.json');

// Deterministic, throwaway secrets — these never touch a real deployment.
// Both must be 32 bytes; any stable value works for tests.
const TEST_KEY = '0'.repeat(64);

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? 'github' : 'html',
	use: {
		baseURL,
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'setup',
			testMatch: /global\.setup\.ts/
		},
		{
			name: 'smoke',
			testMatch: /smoke\.spec\.ts/,
			use: { ...devices['Desktop Chrome'] }
		},
		{
			name: 'authed',
			testMatch: /.*\.authed\.spec\.ts/,
			use: { ...devices['Desktop Chrome'], storageState: ADMIN_STATE },
			dependencies: ['setup']
		}
	],
	webServer: {
		command: 'node build/index.js',
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			HOST,
			PORT: String(PORT),
			ORIGIN: baseURL,
			SELVA_AUTH_PROVIDER: 'local',
			SELVA_DATA_PROVIDER: 'local',
			SELVA_STORAGE_PROVIDER: 'local',
			DATA_PATH: './.e2e/data',
			SELVA_HMAC_KEY: TEST_KEY,
			SELVA_AT_REST_KEY: TEST_KEY
		}
	}
});

// Shared across the setup project and authed specs.
export const ADMIN = {
	email: 'admin@e2e.test',
	password: 'e2e-password-1234',
	company: 'E2E Test Co',
	displayName: 'E2E Admin',
	stateFile: ADMIN_STATE
};
