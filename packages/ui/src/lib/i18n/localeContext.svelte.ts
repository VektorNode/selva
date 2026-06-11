import { getContext, setContext } from 'svelte';
import { type Locale, type ViewerMessages, messagesFor, DEFAULT_LOCALE } from './messages';

// ============================================================================
// Viewer locale context
// ============================================================================
//
// Carries the current UI locale down to the viewer and its panels without
// threading a `lang` prop through every layer. The value is a getter so the
// host can back it with reactive state — flip the language and the viewer
// re-renders live.
//
// Resolution order for any consuming component:
//   explicit `lang` prop  →  nearest locale context  →  English default
//
// Two ways to provide it:
//   - Standalone: <Viewer lang="de" /> — Viewer provides the context itself.
//   - In an app: call setLocaleContext(() => app.locale) once at the root; the
//     viewer (and anything else) reads it. selva later wires its Paraglide
//     locale in here.

const LOCALE_CONTEXT_KEY = Symbol('viewer-locale-context');

export interface LocaleContext {
	/** Current locale. Called reactively — return reactive state to enable live switching. */
	readonly locale: Locale;
	/** Resolved message catalog for the current locale. */
	readonly messages: ViewerMessages;
}

/**
 * Provide the locale to descendants. Pass a getter so a reactive source (a
 * `$state`, a store, the app's Paraglide locale) keeps consumers in sync.
 */
export function setLocaleContext(getLocale: () => Locale | undefined): void {
	const ctx: LocaleContext = {
		get locale() {
			return getLocale() ?? DEFAULT_LOCALE;
		},
		get messages() {
			return messagesFor(getLocale());
		}
	};
	setContext(LOCALE_CONTEXT_KEY, ctx);
}

/**
 * Read the locale context. Falls back to an English-only context when no
 * provider exists (e.g. a primitive used in isolation), so consumers never
 * need a null check.
 */
export function getLocaleContext(): LocaleContext {
	return (
		getContext<LocaleContext | undefined>(LOCALE_CONTEXT_KEY) ?? {
			get locale() {
				return DEFAULT_LOCALE;
			},
			get messages() {
				return messagesFor(DEFAULT_LOCALE);
			}
		}
	);
}
