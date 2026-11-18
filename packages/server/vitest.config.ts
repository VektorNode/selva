import { createVitestConfig } from '@selvajs/config/vitest';

export default createVitestConfig({
	test: {
		// The handler tests write a local-provider data dir per test. Beside other packages'
		// suites (the pre-push hook, CI) a 25 ms test has taken over 5 s on Windows.
		testTimeout: 15_000,
		hookTimeout: 15_000
	}
});
