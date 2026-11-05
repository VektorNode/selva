import { beforeEach, vi } from 'vitest';

const fetchStub = vi.fn();

// At import too: test files read `global.fetch` at module scope.
vi.stubGlobal('fetch', fetchStub);

// Live suites reach the network by calling `vi.unstubAllGlobals()` in their own `beforeEach`. Any
// other suite that unstubs a global must not hand its next test the real fetch.
beforeEach(() => {
	vi.stubGlobal('fetch', fetchStub);
});
