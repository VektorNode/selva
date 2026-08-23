import type { RequestHandler } from './$types';
// Inlined at build time. `openapi/v1.yaml` sits outside `static/` because it is
// a build output of the route registry, not a hand-maintained asset — in
// `static/` it would invite editing the served copy, which the next
// `pnpm openapi:generate` would silently overwrite. Bundling it also means the
// running server does no filesystem lookup relative to a working directory it
// does not control.
import spec from '../../../../../openapi/v1.yaml?raw';

export const GET: RequestHandler = async () =>
	new Response(spec, {
		headers: {
			'Content-Type': 'application/yaml; charset=utf-8',
			'Cache-Control': 'public, max-age=300'
		}
	});
