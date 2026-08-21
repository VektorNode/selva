/**
 * Globals-bound forms of the access guards, for callers with no `deps` to pass.
 *
 * The guards in `access.server.ts` require their providers injected. That is
 * what lets a handler importing one avoid pulling in `providers.server.ts` —
 * which runs a top-level `await createSelvaProviders()`, so importing it boots
 * the whole app. Page loads and form actions have no such constraint and no
 * `deps` in hand, so the fallback lives here instead of inside every guard.
 *
 * **Prefer passing `locals` directly.** `locals.providers` is set on every
 * request by `hooks.server.ts`, so a page load can build real deps with
 * `accessDepsFor(locals)` rather than reaching for module state. This module is
 * for the callers that genuinely have neither — and for keeping the guards
 * themselves free of any import that boots the app.
 */

import {
	getProjectProvider,
	getDefinitionMeta,
	getOrganizationProvider,
	getPlatformProjectGrantStore,
	flag
} from './providers.server.js';
import { projectAccessInputFromRowsWith, type AccessDeps } from './access.server.js';

/**
 * The app's lazily initialized module globals, as `AccessDeps`.
 *
 * Built per call, not once at module scope: the getters resolve through the
 * composition root, and capturing them at import time would pin whatever was
 * wired before boot finished.
 */
export function globalAccessDeps(): AccessDeps {
	return {
		orgs: getOrganizationProvider(),
		projects: getProjectProvider(),
		definitionMeta: getDefinitionMeta(),
		platformProjectGrants: getPlatformProjectGrantStore(),
		flag
	};
}

/** `projectAccessInputFromRowsWith`, bound to the module globals. */
export function projectAccessInputFromRows(
	...args: DropFirst<Parameters<typeof projectAccessInputFromRowsWith>>
) {
	return projectAccessInputFromRowsWith({ deps: globalAccessDeps() }, ...args);
}

type DropFirst<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;
