// Boots the Grasshopper WebSocket stub before the suite; the returned function runs as
// global teardown. The SPA itself is served by the `webServer` in playwright.config.ts.

import type { AddressInfo } from 'node:net';

import { startStub } from './ws-stub';

export default async function globalSetup() {
	// Port 0 lets the OS pick, unless E2E_WS_PORT pins one. Workers start after this returns and
	// inherit the env, so their STUB_PORT is the port bound here.
	const wss = startStub(Number(process.env.E2E_WS_PORT ?? 0));
	await new Promise((resolve) => wss.once('listening', resolve));
	process.env.E2E_WS_PORT = String((wss.address() as AddressInfo).port);
	return async () => {
		await new Promise<void>((resolve) => wss.close(() => resolve()));
	};
}
