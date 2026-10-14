import { TRIGGERS, type DndEvent } from 'svelte-dnd-action';

// Size of the element picked up, captured when a drag starts. Placeholders take this size so the
// layout under the pointer doesn't jump when the library swaps the original out. Module-level
// because a drag that leaves its zone draws its placeholder in another component.
export const dragFootprint = $state({ width: 0, height: 0 });

/** Call from `onconsider` before assigning `e.detail.items`: the original is still in the DOM. */
export function captureDragFootprint(
	e: CustomEvent<DndEvent<{ id: string }>>,
	items: readonly { id: string }[]
): void {
	if (e.detail.info.trigger !== TRIGGERS.DRAG_STARTED) return;
	const index = items.findIndex((item) => item.id === e.detail.info.id);
	const rect = (e.currentTarget as HTMLElement).children[index]?.getBoundingClientRect();
	dragFootprint.width = rect?.width ?? 0;
	dragFootprint.height = rect?.height ?? 0;
}
