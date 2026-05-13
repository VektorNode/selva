import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { GuidSchema, definitionPaths } from '@selvajs/platform/definitions';
import { getDefinitionMeta, getStorageProvider } from '$lib/server/providers.server';
import { requireCanViewProject } from '$lib/server/access.server';

/**
 * Authenticated cover-image proxy. Today this route serves exactly one shape:
 * `/api/files/definitions/{guid}/cover.{ext}` — the URL `LocalStorageProvider`
 * (and, for private-bucket paths, `SupabaseStorageProvider`) returns from
 * `getPublicUrl`. Anything else is rejected.
 *
 * The original implementation was an extension-gated open proxy: any
 * authenticated user could fetch any storage path whose basename matched
 * an allowed image extension. That was M5 in the audit — the path itself
 * was the only authorization, and a leaked GUID let any authed user pull
 * any cover image regardless of project membership.
 *
 * Current contract:
 *   1. Path must match `definitions/{valid-guid}/cover.{ext}` exactly.
 *   2. Caller must be allowed to view the parent definition's project
 *      (`requireCanViewProject`) — same gate as the typed
 *      `/api/definitions/[guid]/image/[filename]` route.
 *   3. Extension allowlist remains as defense in depth.
 *
 * Other file shapes don't exist in storage today; if a future feature
 * needs to serve a different blob via the proxy, it adds an explicit
 * branch with its own auth — never a generic "is the extension allowed"
 * fallthrough.
 */

const ALLOWED_EXTENSIONS: Record<string, string> = {
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif'
};

/**
 * Match `definitions/{guid}/cover.{ext}`. Anchored at both ends so a path
 * like `definitions/{guid}/cover.webp.evil.webp` can't sneak through.
 */
const COVER_PATH_PATTERN =
	/^definitions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/cover\.([a-z]+)$/i;

export const GET: RequestHandler = async ({ params, locals }) => {
	const storagePath = params.path;
	if (!storagePath) throw error(400, 'Missing path');

	// 1. Path-shape gate — only cover images are served here.
	const match = COVER_PATH_PATTERN.exec(storagePath);
	if (!match) throw error(404, 'File not found');
	const [, guid, rawExt] = match;
	const ext = `.${rawExt.toLowerCase()}`;
	if (!ALLOWED_EXTENSIONS[ext]) throw error(404, 'File not found');

	// Belt-and-suspenders: the regex already validated the GUID shape, but
	// running it through the canonical schema keeps the contract tied to
	// one source of truth.
	const guidParsed = GuidSchema.safeParse(guid);
	if (!guidParsed.success) throw error(404, 'File not found');

	if (!locals.ctx) throw error(401, 'Unauthorized');

	// 2. Per-resource auth — the caller must be allowed to view the
	// definition's parent project. Mirrors the typed
	// `/api/definitions/[guid]/image/[filename]` route.
	const record = await getDefinitionMeta().get(locals.ctx, guidParsed.data);
	if (!record) throw error(404, 'File not found');
	await requireCanViewProject(locals, record.projectId);

	// 3. Read the canonical path from `definitionPaths` rather than echoing
	// the user-supplied one — eliminates any chance the request `params.path`
	// passes the regex but resolves to something else after URL decoding.
	const canonicalPath = definitionPaths.image(guidParsed.data);
	const bytes = await getStorageProvider().get(canonicalPath);
	if (!bytes) throw error(404, 'File not found');

	return new Response(Buffer.from(bytes), {
		headers: {
			'Content-Type': ALLOWED_EXTENSIONS[ext],
			'Cache-Control': 'private, max-age=3600'
		}
	});
};
