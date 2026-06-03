import type { UISchema, OutputDynamicValueListLayoutItem } from '@selvajs/schemas';
import { getLayoutItems } from '@selvajs/schemas';

/**
 * The runtime payload a dynamic value list output produces, keyed by the output's id in `values`.
 * Routed back into the dynamic value list input identified by `targetInputId`.
 */
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
 * Normalize a raw output value into a payload object.
 *
 * The local/WebSocket path delivers a real object; the Rhino.Compute path delivers the
 * component's JSON output as a string (possibly double-encoded by the compute layer), so try
 * to parse strings before giving up.
 */
function coercePayload(value: unknown): DynamicValueListPayload | null {
	if (isDynamicValueListPayload(value)) return value;

	let candidate = value;
	// Unwrap up to two layers of JSON string encoding (compute may quote the string output).
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

/** One DynVL routing source: the id keying `values`, plus the schema-side target fallback. */
interface DynamicValueListSource {
	id: string;
	targetInputId?: string | null;
}

/**
 * Every dynamicValueList output reference in the schema.
 *
 * Canonical location is `schema.outputs[]` — the plugin's SchemaSynchronizer enforces that every
 * dynamicValueList layout item is mirrored there (see CanonicalizeDynamicValueListOutputs). We ALSO
 * scan the layout purely as back-compat defense for schemas persisted by an older plugin that lacked
 * that invariant; for current schemas the layout pass finds nothing new.
 * Deduped by id, outputs[] winning so the canonical record's targetInputId takes precedence.
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
 * Build a map of `inputId -> computed options` from the solved output values.
 *
 * Reads each dynamicValueList source's `{ targetInputId, options }` payload from `values` and routes
 * the options to the targeted input. The payload's own `targetInputId` wins; the schema-side
 * `targetInputId` is the fallback when the payload omits it.
 */
export function buildDynamicValueListOptions(
	schema: UISchema,
	values: Record<string, unknown>
): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {};

	for (const source of collectDynamicValueListSources(schema)) {
		const payload = coercePayload(values[source.id]);
		if (!payload) continue;

		const targetInputId = payload.targetInputId ?? source.targetInputId;
		if (!targetInputId) continue;

		if (payload.options && typeof payload.options === 'object') {
			result[targetInputId] = payload.options;
		}
	}

	return result;
}
