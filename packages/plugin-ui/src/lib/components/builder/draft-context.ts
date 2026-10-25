import { getContext, setContext } from 'svelte';
import type { OptionAsset, UISchema } from '@selvajs/schemas';

// Item cards edit their own layout item, but option media also writes the schema's root assets
// table. The builder page provides this so a card can reach the draft without four layers of props.

export interface BuilderDraftAccess {
	/** Runs `apply` as an undoable draft edit; see `editDraft`. */
	edit: (apply: () => void) => void;
	readonly assets: UISchema['assets'];
	/** Stores an asset in the draft and returns its id. Call it inside `edit`. */
	putAsset: (asset: OptionAsset) => string;
}

const KEY = Symbol('builder-draft');

export function setBuilderDraft(access: BuilderDraftAccess): void {
	setContext(KEY, access);
}

export function getBuilderDraft(): BuilderDraftAccess | undefined {
	return getContext<BuilderDraftAccess | undefined>(KEY);
}
