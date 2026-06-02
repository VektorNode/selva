import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// E2E runs the production SPA build (adapter-static) served by `vite preview`, with a
// WebSocket stub standing in for Grasshopper on :8765 (see e2e/ws-stub.ts). The app runs
// unmodified through its GrasshopperSource — this exercises the real transport + the
// SchemaSource seam end to end, which the node-env unit tests can't.
//
// The stub is launched/torn down by e2e/global.setup.ts (Playwright can only health-check
// HTTP webServers, and the stub is a raw WebSocket server).

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.E2E_PORT ?? 4173);
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? 'github' : 'html',
	globalSetup: path.join(__dirname, 'e2e/global.setup.ts'),
	use: {
		baseURL,
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'smoke',
			testMatch: /.*\.spec\.ts/,
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: 'pnpm build && pnpm preview --port ' + PORT + ' --host ' + HOST,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
