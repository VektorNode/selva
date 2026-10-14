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

// An expanded group can be taller than the viewport; cap the clone so the drop target stays
// visible. The placeholder keeps the full height, so the layout itself doesn't move.
export function liftDraggedGroup(el?: HTMLElement): void {
	if (!el) return;
	liftDraggedElement(el);
	el.style.maxHeight = '220px';
	el.style.overflow = 'hidden';
	el.style.maskImage = 'linear-gradient(to bottom, black 65%, transparent)';
}
