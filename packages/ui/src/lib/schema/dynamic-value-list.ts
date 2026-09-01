import type { UISchema, OutputDynamicValueListLayoutItem } from '@selvajs/schemas';
import { getLayoutItems } from '@selvajs/schemas';

/** Runtime payload a dynamic value list output produces, routed to the input identified by `targetInputId`. */
export interface DynamicValueListPayload {
	targetInputId?: string | null;
	options?: Record<string, string>;
}

function isDynamicValueListPayload(value: unknown): value is DynamicValueListPayload {
	return (
		typeof value === 'object' && value !== null && ('targetInputId' in value || 'options' in value)
	);
}

/**
 * The local/WebSocket path delivers a real object; the Rhino.Compute path delivers the
 * component's JSON output as a string, possibly double-encoded by the compute layer.
 */
function coercePayload(value: unknown): DynamicValueListPayload | null {
	if (isDynamicValueListPayload(value)) return value;

	let candidate = value;
	// Compute may quote the string output, so unwrap up to two layers of JSON encoding.
	for (let i = 0; i < 2 && typeof candidate === 'string'; i++) {
		try {
			candidate = JSON.parse(candidate);
		} catch {
			return null;
		}
		if (isDynamicValueListPayload(candidate)) return candidate;
	}

	return null;
}

// In compute mode the payload arrives as a multi-MB JSON string, and the options map
// recomputes on every value change. Unmemoized, each keystroke re-parses megabytes and
// allocates a fresh options object whose new identity re-renders the whole dropdown
// subtree; a 6.4 MB payload drove a tab OOM.
const coerceCache = new Map<string, DynamicValueListPayload | null>();
const COERCE_CACHE_MAX = 8;

function coercePayloadMemo(value: unknown): DynamicValueListPayload | null {
	// Small strings parse cheap enough that memoizing them isn't worth the cache churn.
	if (typeof value !== 'string' || value.length < 1024) return coercePayload(value);
	// Map keys use SameValueZero, so an identical string from a later solve also hits.
	const hit = coerceCache.get(value);
	if (hit !== undefined || coerceCache.has(value)) {
		// Delete then re-add to refresh LRU position.
		coerceCache.delete(value);
		coerceCache.set(value, hit ?? null);
		return hit ?? null;
	}
	const parseStart = performance.now();
	const parsed = coercePayload(value);
	// If this logs repeatedly for what should be the same solve result, memoization is
	// being defeated: the churn pattern that can OOM a tab.
	if (value.length > 256 * 1024) {
		const optionCount = parsed?.options ? Object.keys(parsed.options).length : 0;
		console.info(
			`[DVL] parsed ${(value.length / (1024 * 1024)).toFixed(1)} MB options payload ` +
				`(${optionCount} options) in ${(performance.now() - parseStart).toFixed(0)}ms — cache miss`
		);
	}
	if (coerceCache.size >= COERCE_CACHE_MAX) {
		const oldest = coerceCache.keys().next().value;
		if (oldest !== undefined) coerceCache.delete(oldest);
	}
	coerceCache.set(value, parsed);
	return parsed;
}

/** One DynVL routing source: the id keying `values`, plus the schema-side target fallback. */
interface DynamicValueListSource {
	id: string;
	targetInputId?: string | null;
}

/**
 * `schema.outputs[]` is canonical: the plugin's SchemaSynchronizer mirrors every
 * dynamicValueList layout item there. The layout scan is back-compat defense for schemas
 * persisted before that invariant existed; on current schemas it finds nothing new.
 * Deduped by id, with `outputs[]` winning so its targetInputId takes precedence.
 */
function collectDynamicValueListSources(schema: UISchema): DynamicValueListSource[] {
	const byId = new Map<string, DynamicValueListSource>();

	for (const item of getLayoutItems(schema)) {
		if (item.type !== 'output' || item.widgetType !== 'dynamicValueList') continue;
		const dvl = item as OutputDynamicValueListLayoutItem;
		if (typeof dvl.paramId !== 'string') continue;
		byId.set(dvl.paramId, { id: dvl.paramId, targetInputId: dvl.config?.targetInputId });
	}

	for (const output of schema.outputs ?? []) {
		if (output.type !== 'dynamicValueList') continue;
		byId.set(output.id, { id: output.id, targetInputId: output.targetInputId });
	}

	return [...byId.values()];
}

/**
 * Builds a map of inputId -> computed options from the solved output values, routing each
 * source's options to its target input. The payload's own `targetInputId` wins; the
 * schema-side one is the fallback when the payload omits it.
 */
export function buildDynamicValueListOptions(
	schema: UISchema,
	values: Record<string, unknown>
): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {};

	for (const source of collectDynamicValueListSources(schema)) {
		const payload = coercePayloadMemo(values[source.id]);
		if (!payload) continue;

		const targetInputId = payload.targetInputId ?? source.targetInputId;
		if (!targetInputId) continue;

		if (payload.options && typeof payload.options === 'object') {
			result[targetInputId] = payload.options;
		}
	}

	return result;
}
