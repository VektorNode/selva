import type { SchemaOutput } from '@selvajs/schemas';

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
 * Build a map of `inputId -> computed options` from the solved output values.
 *
 * Scans every `dynamicValueList` output in the schema, reads its `{ targetInputId, options }`
 * payload from `values`, and routes the options to the targeted input. The output's own
 * `targetInputId` (from the schema) is used as a fallback when the payload omits it.
 */
export function buildDynamicValueListOptions(
	outputs: SchemaOutput[],
	values: Record<string, unknown>
): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {};

	for (const output of outputs) {
		if (output.type !== 'dynamicValueList') continue;

		const payload = values[output.id];
		if (!isDynamicValueListPayload(payload)) continue;

		const targetInputId = payload.targetInputId ?? output.targetInputId;
		if (!targetInputId) continue;

		if (payload.options && typeof payload.options === 'object') {
			result[targetInputId] = payload.options;
		}
	}

	return result;
}
