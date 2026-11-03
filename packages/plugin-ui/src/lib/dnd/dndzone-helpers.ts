import type {
	DiscoveredInput,
	DiscoveredOutput,
	GroupConfig,
	LayoutItem,
	TabConfig
} from '@selvajs/schemas';

// ============================================================================
// dnd type constants — prefixed to avoid collisions in svelte-dnd-action's
// global type namespace.
// ============================================================================

export const DND_TYPE_PARAM = 'selva-param';
export const DND_TYPE_GROUP = 'selva-group';

// ============================================================================
// Shape type-guards used in finalize bodies to detect foreign-shaped drops.
// ============================================================================

export function isLayoutItem(x: unknown): x is LayoutItem {
	if (!x || typeof x !== 'object') return false;
	const t = (x as { type?: unknown }).type;
	return t === 'input' || t === 'output' || t === 'linebreak';
}

export function isDiscoveredInput(x: unknown): x is DiscoveredInput {
	if (!x || typeof x !== 'object') return false;
	const o = x as Record<string, unknown>;
	return (
		typeof o.id === 'string' &&
		typeof o.name === 'string' &&
		!('type' in o && (o.type === 'input' || o.type === 'output' || o.type === 'linebreak'))
	);
}

export function isDiscoveredOutput(x: unknown): x is DiscoveredOutput {
	if (!x || typeof x !== 'object') return false;
	const o = x as Record<string, unknown>;
	if (typeof o.id !== 'string') return false;
	if ('paramId' in o) return false; // LayoutItem has paramId
	if (!('nickname' in o)) return false;
	if ('name' in o) return false; // DiscoveredInput has name
	return true;
}

export function isGroupConfig(x: unknown): x is GroupConfig {
	if (!x || typeof x !== 'object') return false;
	const o = x as Record<string, unknown>;
	return (
		typeof o.id === 'string' &&
		typeof o.label === 'string' &&
		Array.isArray(o.items) &&
		!('groups' in o)
	);
}

export function isTabConfig(x: unknown): x is TabConfig {
	if (!x || typeof x !== 'object') return false;
	const o = x as Record<string, unknown>;
	return typeof o.id === 'string' && Array.isArray(o.groups);
}

// ============================================================================
// Reorder on finalize
// ============================================================================

/** Where the dragged item moved, as splice indices; null when it didn't move. */
export function draggedItemMove(
	oldIds: readonly string[],
	newIds: readonly string[],
	draggedId: string
): { from: number; to: number } | null {
	const from = oldIds.indexOf(draggedId);
	const to = newIds.indexOf(draggedId);
	if (from === -1 || to === -1 || from === to) return null;
	return { from, to };
}

// ============================================================================
// Shared drag feel
// ============================================================================

export const DND_TYPE_TAB = 'selva-tab';

/** Pass the same value to the zone's `flipDurationMs` and to `animate:flip` on its items. */
export const DND_FLIP_MS = 180;

// The library moves the clone with `transform`, so the lift uses the independent `scale`
// property and a `filter` shadow, which follows the card's rounded corners. The library also
// focuses the clone, which draws a square focus ring around the rounded card.
export function liftDraggedElement(el?: HTMLElement): void {
	if (!el) return;
	el.style.outline = 'none';
	el.style.scale = '1.02';
	el.style.filter = 'drop-shadow(0 10px 18px rgb(0 0 0 / 0.18))';
	el.style.opacity = '0.95';
}

// The library calls the transform again each time the clone enters a zone, so this is idempotent.
const DRAG_COUNT_ATTR = 'data-drag-count';

/**
 * Lifts the clone and, when it carries a selection, stacks two card edges behind it and pins a
 * count badge, so a multi-row drag never looks like a single row.
 */
export function liftWithCount(el: HTMLElement | undefined, count: number): void {
	if (!el) return;
	liftDraggedElement(el);
	if (count < 2 || el.querySelector(`[${DRAG_COUNT_ATTR}]`)) return;

	// The clone's outer div is square; the card inside carries the radius the stack must follow.
	const card = el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el;
	card.style.boxShadow =
		'4px 4px 0 -1px var(--raised), 4px 4px 0 0 var(--border-strong), ' +
		'8px 8px 0 -1px var(--raised), 8px 8px 0 0 var(--border-strong)';

	const badge = document.createElement('span');
	badge.setAttribute(DRAG_COUNT_ATTR, '');
	badge.textContent = String(count);
	Object.assign(badge.style, {
		position: 'absolute',
		top: '-8px',
		right: '-8px',
		minWidth: '20px',
		height: '20px',
		padding: '0 6px',
		display: 'grid',
		placeItems: 'center',
		borderRadius: '9999px',
		background: 'var(--primary)',
		color: 'var(--primary-foreground)',
		font: '600 11px/1 ui-sans-serif, system-ui, sans-serif',
		fontVariantNumeric: 'tabular-nums',
		zIndex: '1'
	});
	el.appendChild(badge);
}

// An expanded group can be taller than the viewport; cap the clone so the drop target stays
// visible. The placeholder keeps the full height, so the layout itself doesn't move.
export function liftDraggedGroup(el?: HTMLElement): void {
	if (!el) return;
	liftDraggedElement(el);
	el.style.maxHeight = '220px';
	el.style.overflow = 'hidden';
	el.style.maskImage = 'linear-gradient(to bottom, black 65%, transparent)';
}
