import { getContext, setContext } from 'svelte';

// The builder page derives the set of paramIds whose client/server source key collides with
// another input's, and provides it here. BuilderGroupItem reads it to flag the offending
// inputs inline — without threading a prop through TabEditor and EditableGroup. The value is
// a getter so the reactive set stays live across re-derivations.

const KEY = Symbol('duplicate-source-keys');

export function setDuplicateSourceKeys(get: () => Set<string>): void {
	setContext(KEY, get);
}

export function getDuplicateSourceKeys(): () => Set<string> {
	return getContext<() => Set<string>>(KEY) ?? (() => new Set<string>());
}
