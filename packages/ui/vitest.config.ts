import { svelte } from '@sveltejs/vite-plugin-svelte';

import { createVitestConfig } from '@selvajs/config/vitest';

// Tests cover the pure schema/logic modules plus `.svelte.ts` rune modules (the throttle
// and solve-session wrapper). The svelte plugin lets `$state`/`$derived` runes compile and
// run in tests — this is rune *module* execution, NOT component mounting (no DOM, no
// Tailwind/kit pipeline needed). Component mounting is still out of scope.
export default createVitestConfig({
	plugins: [svelte()]
});
