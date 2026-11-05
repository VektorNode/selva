import { getContext, setContext } from 'svelte';
import {
	type Locale,
	type ViewerMessages,
	messagesFor,
	withOverrides,
	DEFAULT_LOCALE
} from './messages';

// Carries the UI locale down to the viewer and its panels without threading a
// `lang` prop through every layer.
//
// Resolution order for any consuming component:
//   explicit `lang` prop  →  nearest locale context  →  English default
// and the strings are that locale's catalog with any `messages` overrides on top.
//
// Two ways to provide it:
//   - Standalone: <Viewer lang="de" /> — Viewer provides the context itself.
//   - In an app: call setLocaleContext(() => app.locale) once at the root; the
//     viewer (and anything else) reads it.

const LOCALE_CONTEXT_KEY = Symbol('viewer-locale-context');

export interface LocaleContext {
	readonly locale: Locale;
	readonly messages: ViewerMessages;
}

/**
 * Provide the locale to descendants. Pass getters, not values: they are re-read on every
 * consumer render, so a reactive source (a `$state`, the app's Paraglide locale) switches
 * the language live. `getOverrides` replaces individual strings of the resolved catalog.
 */
export function setLocaleContext(
	getLocale: () => Locale | undefined,
	getOverrides?: () => Partial<ViewerMessages> | undefined
): void {
	const ctx: LocaleContext = {
		get locale() {
			return getLocale() ?? DEFAULT_LOCALE;
		},
		get messages() {
			return withOverrides(messagesFor(getLocale()), getOverrides?.());
		}
	};
	setContext(LOCALE_CONTEXT_KEY, ctx);
}

/**
 * Re-provides the nearest context for a component that takes its own `lang`/`messages` props.
 * Without `lang`, or with the inherited locale, the subtree keeps the overrides an outer provider
 * applied; a different `lang` starts from that locale's catalog, since those overrides were
 * written for another language.
 */
export function layerLocaleContext(
	getLang: () => Locale | undefined,
	getOverrides?: () => Partial<ViewerMessages> | undefined
): LocaleContext {
	const outer = getLocaleContext();
	const ctx: LocaleContext = {
		get locale() {
			return getLang() ?? outer.locale;
		},
		get messages() {
			const lang = getLang();
			const base = lang === undefined || lang === outer.locale ? outer.messages : messagesFor(lang);
			return withOverrides(base, getOverrides?.());
		}
	};
	setContext(LOCALE_CONTEXT_KEY, ctx);
	return ctx;
}

/**
 * Falls back to an English-only context when no provider exists (a primitive used in
 * isolation), so consumers never need a null check.
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
