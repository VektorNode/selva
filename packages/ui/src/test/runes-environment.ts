import type { Environment } from 'vitest/runtime';

// Node's globals, but modules transformed by Vite's client environment, so the svelte plugin
// compiles runes the way a browser runs them. Nothing here needs a DOM.
export default {
	name: 'runes',
	viteEnvironment: 'client',
	setup: () => ({ teardown: () => {} })
} satisfies Environment;
