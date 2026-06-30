import { ALL_ORG_ASSET_KINDS } from '../organizations/schemas.js';
import { COVER_IMAGE_EXTENSIONS } from '../definitions/types.js';

/**
 * How a stored asset is allowed to be read. This is a property of the asset
 * *class* (its path prefix), never of the individual file — so a logo and a
 * pricing sheet differ only in which class they belong to, and adding a new
 * asset type is one entry in {@link ASSET_CLASSES} rather than a new route.
 *
 * - `public`  — anyone, including logged-out visitors. Served with no auth via
 *   a CDN/public bucket (Supabase) or a shape-gated proxy branch (local). Used
 *   for branding (logo, favicon) that appears on viewer headers and login pages.
 * - `org`     — members of the owning org only. The route resolves the orgId
 *   from the path and runs an org-membership check. Used for org-private docs
 *   (e.g. pricing sheets) once they exist.
 * - `project` — members of the owning project only. The route resolves the
 *   definition guid → its project and runs the project-view check. Used for
 *   definition cover images and other per-definition blobs.
 */
export type AssetVisibility = 'public' | 'org' | 'project';

/**
 * What scope id the route must authorize against. `none` for public assets
 * (no scope to check); `org`/`project` carry the id extracted from the path.
 */
export type AssetScope = 'none' | 'org' | 'project';

export interface AssetClass {
	/** Stable identifier — for logging and tests, not user-facing. */
	readonly id: string;
	readonly visibility: AssetVisibility;
	readonly scope: AssetScope;
	/**
	 * Anchored matcher for this class's storage paths. Capture group 1 (when
	 * present) is the scope id (orgId or guid) the route authorizes against.
	 */
	readonly pattern: RegExp;
}

export interface AssetMatch {
	readonly class: AssetClass;
	/** The scope id from the path, or null for `scope: 'none'` classes. */
	readonly scopeId: string | null;
}

// Org branding kinds (logo, favicon, …) are the public set. Built from the
// schema enum so adding a kind there extends this pattern automatically.
const BRANDING_KINDS = ALL_ORG_ASSET_KINDS.join('|');

// Cover extensions are derived from the canonical `COVER_IMAGE_EXTENSIONS`
// (definitions/types.ts) — strip the leading dot and escape so adding a new
// cover format there propagates here instead of silently 404ing legit covers.
const COVER_EXTS = COVER_IMAGE_EXTENSIONS.map((ext) =>
	ext.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).join('|');

// Reusable segment alphabets. `SAFE_SEGMENT` mirrors the `assertSafeKey`
// alphabet in the path helpers (traversal/empty segments are rejected
// separately by `hasUnsafeSegment`); `GUID` is the canonical definition guid
// shape — kept in sync with `UUID_REGEX` in definitions/schemas.ts.
const SAFE_SEGMENT = String.raw`[A-Za-z0-9._-]+`;
const GUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

/**
 * The closed registry of servable asset classes. Order matters only for
 * readability — patterns are mutually exclusive by prefix. Anything that
 * matches no class is unservable (the route 404s), which keeps the proxy
 * default-deny: a new blob type is opt-in by adding an entry here.
 */
export const ASSET_CLASSES: readonly AssetClass[] = [
	{
		id: 'org-branding',
		visibility: 'public',
		scope: 'none',
		pattern: new RegExp(
			String.raw`^orgs\/(${SAFE_SEGMENT})\/branding\/(?:${BRANDING_KINDS})\.webp$`
		)
	},
	{
		id: 'org-private',
		visibility: 'org',
		scope: 'org',
		pattern: new RegExp(String.raw`^orgs\/(${SAFE_SEGMENT})\/private\/${SAFE_SEGMENT}$`)
	},
	{
		id: 'definition-cover',
		visibility: 'project',
		scope: 'project',
		pattern: new RegExp(String.raw`^definitions\/(${GUID})\/cover\.(?:${COVER_EXTS})$`, 'i')
	}
];

/**
 * Reject any path that contains a traversal, empty, or backslash segment
 * *before* it can match a class. The class patterns use a permissive segment
 * alphabet (`[A-Za-z0-9._-]+`) so dotted ids and filenames work, but that
 * alphabet also admits a bare `.` or `..` *as a whole segment* — which would
 * let `orgs/../branding/logo.webp` classify as public branding with `..`
 * captured as the orgId. This mirrors `assertSafeKey` in the path builders:
 * the registry is the read-side gate, those are the write-side gate, and both
 * forbid the same segments so a path that can't be *written* can't be *read*.
 */
function hasUnsafeSegment(storagePath: string): boolean {
	if (storagePath.includes('\\')) return true;
	for (const segment of storagePath.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') return true;
	}
	return false;
}

/**
 * Classify a storage path into its asset class and scope id, or null when no
 * class matches (or the path is unsafe). Callers — `getPublicUrl` (to pick CDN
 * vs proxy) and the serving route (to pick the auth check) — consult this so
 * URL generation and authorization never drift apart.
 *
 * For `org-branding` the orgId is captured as group 1 but the class is public,
 * so `scopeId` is reported as the captured id only when the class actually
 * authorizes against it (`scope !== 'none'`); public classes report null.
 */
export function classifyAssetPath(storagePath: string): AssetMatch | null {
	if (hasUnsafeSegment(storagePath)) return null;
	for (const cls of ASSET_CLASSES) {
		const m = cls.pattern.exec(storagePath);
		if (!m) continue;
		return { class: cls, scopeId: cls.scope === 'none' ? null : (m[1] ?? null) };
	}
	return null;
}

/** True when the path belongs to a `public` asset class (CDN-servable, no auth). */
export function isPublicAssetPath(storagePath: string): boolean {
	return classifyAssetPath(storagePath)?.class.visibility === 'public';
}
