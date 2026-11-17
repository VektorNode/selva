import type { IBindingResolver, RequestContext } from '@selvajs/platform';
import { getInputItems, type UISchema } from '@selvajs/schemas';

/**
 * Values for the schema's `server`-sourced inputs, by input id, from one batched
 * `resolver.resolve` call over their `source.key`s. Pass the result as
 * `SolveEngine.solve`'s `boundValues`. An input whose key did not resolve, or that
 * has no key, is left out and solves on its schema default. Several inputs may share a key.
 */
export async function resolveBoundValues(
	schema: UISchema,
	resolver: IBindingResolver,
	ctx: RequestContext,
	scope?: unknown
): Promise<Record<string, unknown>> {
	const keyByInput = new Map<string, string>();
	for (const item of getInputItems(schema)) {
		if (item.source?.kind === 'server' && item.source.key) {
			keyByInput.set(item.paramId, item.source.key);
		}
	}
	if (keyByInput.size === 0) return {};

	const resolved = await resolver.resolve(ctx, [...new Set(keyByInput.values())], scope);
	const out: Record<string, unknown> = {};
	for (const [inputId, key] of keyByInput) {
		if (resolved.has(key)) out[inputId] = resolved.get(key);
	}
	return out;
}
