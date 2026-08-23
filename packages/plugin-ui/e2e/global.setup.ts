// Boots the Grasshopper WebSocket stub before the suite; the returned function runs as
// global teardown. The SPA itself is served by the `webServer` in playwright.config.ts.

import { startStub, STUB_PORT } from './ws-stub';

export default function globalSetup() {
	const wss = startStub(STUB_PORT);
	return async () => {
		await new Promise<void>((resolve) => wss.close(() => resolve()));
	};
}
