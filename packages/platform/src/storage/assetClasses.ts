import { ALL_ORG_ASSET_KINDS } from '../organizations/schemas.js';
import { COVER_IMAGE_EXTENSIONS } from '../definitions/types.js';

/**
 * How a stored asset is allowed to be read. A property of the asset *class*
 * (its path prefix), never of the individual file — a new asset type is one
 * entry in {@link ASSET_CLASSES} rather than a new route.
 *
 * - `public`  — anyone, including logged-out visitors (branding: logo, favicon).
 * - `org`     — members of the owning org only; route resolves orgId from the path.
 * - `project` — members of the owning project only; route resolves the
 *   definition guid to its project (cover images, per-definition blobs).
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

// Built from the schema enum so a new branding kind extends this pattern automatically.
const BRANDING_KINDS = ALL_ORG_ASSET_KINDS.join('|');

// Derived from COVER_IMAGE_EXTENSIONS so a new cover format propagates here
// instead of silently 404ing legit covers.
const COVER_EXTS = COVER_IMAGE_EXTENSIONS.map((ext) =>
	ext.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
).join('|');

// SAFE_SEGMENT mirrors the assertSafeKey alphabet in the path helpers
// (traversal/empty segments are rejected separately by hasUnsafeSegment);
// GUID is kept in sync with UUID_REGEX in definitions/schemas.ts.
const SAFE_SEGMENT = String.raw`[A-Za-z0-9._-]+`;
const GUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

/**
 * The closed registry of servable asset classes. Patterns are mutually
 * exclusive by prefix, order doesn't matter. Anything matching no class is
 * unservable (the route 404s) — default-deny, so a new blob type is opt-in.
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
 * Rejects traversal, empty, or backslash segments before a path can match a
 * class. The permissive segment alphabet (`[A-Za-z0-9._-]+`) admits a bare
 * `.` or `..` as a whole segment, which would otherwise let
 * `orgs/../branding/logo.webp` classify as public branding with `..`
 * captured as the orgId. Mirrors `assertSafeKey` on the write side, so a path
 * that can't be written can't be read either.
 */
function hasUnsafeSegment(storagePath: string): boolean {
	if (storagePath.includes('\\')) return true;
	for (const segment of storagePath.split('/')) {
		if (segment === '' || segment === '.' || segment === '..') return true;
	}
	return false;
}

/**
 * Classifies a storage path into its asset class and scope id, or null when
 * no class matches (or the path is unsafe). `getPublicUrl` and the serving
 * route both consult this so URL generation and authorization never drift
 * apart.
 *
 * `scopeId` is null for `scope: 'none'` classes even when the pattern
 * captures an id (e.g. `org-branding` captures orgId but is public).
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
