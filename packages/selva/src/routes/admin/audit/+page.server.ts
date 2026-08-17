import type { PageServerLoad } from './$types';
import type {
	AuditEventRow,
	AuditCursor,
	AuditQueryFilters,
	DomainEvent,
	DomainEventType
} from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';
import { assertPagePermission } from '$lib/server/access.server';
import {
	getAuditQuery,
	getDefinitionMeta,
	getOrganizationProvider,
	getProjectProvider,
	getUserProfileStore
} from '$lib/server/providers.server';
import { getAuthProvider } from '$lib/server/auth.server';

/**
 * Closed allowlist of event types — `searchParams` come from untrusted user
 * input, so we filter to known variants before forwarding to the query layer.
 *
 * Keyed as a `Record<DomainEventType, true>` rather than an array so a new
 * variant in the union is a type error here. An array would silently omit it,
 * and the omission only shows as a filter option that never appears.
 */
const EVENT_TYPE_ALLOWLIST: Record<DomainEventType, true> = {
	'org.created': true,
	'org.deleted': true,
	'org_member.added': true,
	'org_member.removed': true,
	'org_member.role_changed': true,
	'org_member.permissions_changed': true,
	'project.created': true,
	'project.deleted': true,
	'project_member.added': true,
	'project_member.removed': true,
	'project_member.role_changed': true,
	'project.reclaimed': true,
	'definition.created': true,
	'definition.deleted': true,
	'definition.published': true,
	'definition_version.created': true,
	'definition_version.deleted': true,
	'share_link.minted': true,
	'share_link.revoked': true,
	'invite.created': true,
	'invite.accepted': true,
	'invite.revoked': true,
	'user.created': true,
	'user.deleted': true,
	'user.disabled': true,
	'platform_permissions.changed': true,
	'system.update.started': true,
	'system.update.finished': true,
	'system.update.rolled_back': true,
	'system.update.failed': true
};

const KNOWN_EVENT_TYPES = Object.keys(EVENT_TYPE_ALLOWLIST) as readonly DomainEventType[];

const KNOWN_TYPE_SET = new Set<string>(KNOWN_EVENT_TYPES);

export interface AuditActorView {
	id: string;
	/** Resolved display name or email. `null` when unresolvable (deleted account). */
	name: string | null;
	/** True for `actorId === 'system'` — UI distinguishes system events. */
	isSystem: boolean;
}

export type AuditTargetKind =
	'org' | 'project' | 'definition' | 'definition_version' | 'share_link' | 'invite' | 'user';

export interface AuditTargetView {
	kind: AuditTargetKind;
	id: string;
	/** Resolved name or `null` when the target row is gone (hard-deleted, soft-deleted, or never existed). */
	name: string | null;
}

export interface EnrichedAuditRow extends AuditEventRow {
	actor: AuditActorView;
	target: AuditTargetView | null;
}

export interface AuditPageData {
	available: boolean;
	rows: EnrichedAuditRow[];
	knownTypes: readonly DomainEventType[];
	filters: {
		types: DomainEventType[];
		actorId: string;
		sinceIso: string;
		untilIso: string;
	};
	nextCursor: AuditCursor | null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	assertPagePermission(locals, 'instance_admin');

	const auditQuery = getAuditQuery();
	const requestedFilters = parseFilters(url.searchParams);

	if (!auditQuery) {
		return {
			available: false,
			rows: [],
			knownTypes: KNOWN_EVENT_TYPES,
			filters: requestedFilters,
			nextCursor: null
		} satisfies AuditPageData;
	}

	const result = await auditQuery.list(SYSTEM_CONTEXT, toQueryFilters(requestedFilters, url));

	const rows = await enrichRows(result.rows);

	return {
		available: true,
		rows,
		knownTypes: KNOWN_EVENT_TYPES,
		filters: requestedFilters,
		nextCursor: result.nextCursor
	} satisfies AuditPageData;
};

function parseFilters(params: URLSearchParams): AuditPageData['filters'] {
	const types = params.getAll('type').filter((t): t is DomainEventType => KNOWN_TYPE_SET.has(t));
	const actorId = (params.get('actor') ?? '').trim();
	const sinceIso = (params.get('since') ?? '').trim();
	const untilIso = (params.get('until') ?? '').trim();
	return { types, actorId, sinceIso, untilIso };
}

function toQueryFilters(filters: AuditPageData['filters'], url: URL): AuditQueryFilters {
	const cursor = parseCursor(url.searchParams.get('cursor'));
	return {
		types: filters.types.length > 0 ? filters.types : undefined,
		actorId: filters.actorId || undefined,
		sinceIso: normalizeBoundary(filters.sinceIso, 'start'),
		untilIso: normalizeBoundary(filters.untilIso, 'end'),
		limit: 100,
		cursor: cursor ?? undefined
	};
}

/**
 * Date inputs come back as `YYYY-MM-DD`. Expand to a full ISO range so a
 * `since=2026-04-01&until=2026-04-29` filter actually covers all of April 29.
 */
function normalizeBoundary(value: string, edge: 'start' | 'end'): string | undefined {
	if (!value) return undefined;
	if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
	}
	// Already a full ISO timestamp (cursor round-trips, advanced users).
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return undefined;
	return d.toISOString();
}

// `URLSearchParams.get` already URL-decodes the value, so the cursor JSON
// arrives here as plain text. Don't decode again. We only validate the
// shape of the parsed object — the adapter layer enforces the value formats
// (ISO timestamp, UUID) before any string interpolation.
function parseCursor(raw: string | null): AuditCursor | null {
	if (!raw) return null;
	try {
		const decoded = JSON.parse(raw) as { occurredAt?: unknown; id?: unknown };
		if (typeof decoded.occurredAt === 'string' && typeof decoded.id === 'string') {
			return { occurredAt: decoded.occurredAt, id: decoded.id };
		}
	} catch {
		// Malformed cursor — treat as no cursor.
	}
	return null;
}

async function enrichRows(rows: AuditEventRow[]): Promise<EnrichedAuditRow[]> {
	if (rows.length === 0) return [];

	// Collect distinct ids per kind so we batch each lookup once.
	const actorIds = new Set<string>();
	const orgIds = new Set<string>();
	const projectIds = new Set<string>();
	const definitionIds = new Set<string>();
	const userIds = new Set<string>();

	for (const row of rows) {
		// `share:` actors are anonymous — no profile and no auth user to resolve,
		// so keep them out of both batch lookups. `resolveActor` names them.
		if (row.actorId && row.actorId !== 'system' && !row.actorId.startsWith('share:')) {
			actorIds.add(row.actorId);
		}
		const target = targetFor(row.data);
		if (target) {
			if (target.kind === 'org') orgIds.add(target.id);
			else if (target.kind === 'project') projectIds.add(target.id);
			else if (target.kind === 'definition') definitionIds.add(target.id);
			// A user target resolves through the same profile/auth lookup as an
			// actor, so it rides the existing batch rather than adding a third one.
			else if (target.kind === 'user') userIds.add(target.id);
		}
	}

	const profileStore = getUserProfileStore();
	const orgs = getOrganizationProvider();
	const projects = getProjectProvider();
	const definitions = getDefinitionMeta();
	const auth = getAuthProvider();

	// Resolve each id to a [id, value|null] tuple so the Map construction is
	// not order-dependent (and stays correct if any caller iterates a Set
	// twice with a different intermediate operation).
	// Actors and user targets resolve identically, so they share one lookup.
	const peopleIds = new Set([...actorIds, ...userIds]);

	const [profiles, orgEntries, projectEntries, definitionEntries] = await Promise.all([
		peopleIds.size > 0
			? profileStore.getProfiles(SYSTEM_CONTEXT, [...peopleIds])
			: Promise.resolve([]),
		Promise.all(
			[...orgIds].map(
				async (id) => [id, await orgs.getOrg(SYSTEM_CONTEXT, id).catch(() => null)] as const
			)
		),
		Promise.all(
			[...projectIds].map(
				async (id) => [id, await projects.getProject(SYSTEM_CONTEXT, id).catch(() => null)] as const
			)
		),
		Promise.all(
			[...definitionIds].map(
				async (id) => [id, await definitions.get(SYSTEM_CONTEXT, id).catch(() => null)] as const
			)
		)
	]);

	const profileById = new Map(profiles.map((p) => [p.userId, p]));

	// Fall back to the auth provider for actors without a profile-store
	// `displayName` — Supabase Auth is the source of truth for emails when
	// profile state hasn't been seeded yet.
	const unresolved = [...peopleIds].filter((id) => !profileById.get(id)?.displayName);
	const authEntries = await Promise.all(
		unresolved.map(async (id) => [id, await auth.getUser(id).catch(() => null)] as const)
	);
	const authById = new Map(authEntries.filter(([, u]) => u !== null));

	const orgById = new Map(orgEntries.filter(([, v]) => v !== null));
	const projectById = new Map(projectEntries.filter(([, v]) => v !== null));
	const definitionById = new Map(definitionEntries.filter(([, v]) => v !== null));

	return rows.map((row) => {
		const target = targetFor(row.data);
		let resolvedTarget: AuditTargetView | null = null;
		if (target) {
			let name: string | null = null;
			if (target.kind === 'org') name = orgById.get(target.id)?.name ?? null;
			else if (target.kind === 'project') name = projectById.get(target.id)?.name ?? null;
			else if (target.kind === 'definition')
				name = definitionById.get(target.id)?.displayName ?? null;
			else if (target.kind === 'user')
				// A deleted user resolves to neither, leaving the raw id — which is
				// the point: the row outlives the person it names.
				name = profileById.get(target.id)?.displayName ?? authById.get(target.id)?.email ?? null;
			resolvedTarget = { kind: target.kind, id: target.id, name };
		}

		const actorView = resolveActor(row.actorId, profileById, authById);
		return { ...row, actor: actorView, target: resolvedTarget };
	});
}

function resolveActor(
	actorId: string,
	profileById: Map<string, { displayName?: string }>,
	authById: Map<string, { email?: string } | null>
): AuditActorView {
	if (!actorId || actorId === 'system') {
		return { id: 'system', name: 'System', isSystem: true };
	}
	// A share-link actor is anonymous and has no profile to look up. Naming the
	// link keeps it distinguishable from the platform itself, which is what a
	// blank actor renders as one branch above.
	if (actorId.startsWith('share:')) {
		return { id: actorId, name: `Share link ${actorId.slice('share:'.length)}`, isSystem: false };
	}
	const display = profileById.get(actorId)?.displayName;
	if (display) return { id: actorId, name: display, isSystem: false };
	const email = authById.get(actorId)?.email;
	if (email) return { id: actorId, name: email, isSystem: false };
	return { id: actorId, name: null, isSystem: false };
}

/**
 * Distil the "what was acted on" pointer from a domain event. Some variants
 * (`share_link.revoked`, `definition_version.deleted`) only carry the entity
 * id with no parent reference — the UI surfaces those as kind + id with no
 * resolvable name. The `data` payload still appears in the row's expandable
 * details, so nothing is lost.
 */
function targetFor(event: DomainEvent): { kind: AuditTargetKind; id: string } | null {
	switch (event.type) {
		case 'org.created':
		case 'org.deleted':
		case 'org_member.added':
		case 'org_member.removed':
		case 'org_member.role_changed':
		case 'org_member.permissions_changed':
			return { kind: 'org', id: event.orgId };
		case 'project.created':
		case 'project.deleted':
		case 'project.reclaimed':
		case 'project_member.added':
		case 'project_member.removed':
		case 'project_member.role_changed':
			return { kind: 'project', id: event.projectId };
		case 'definition.created':
		case 'definition.deleted':
		case 'definition.published':
			return { kind: 'definition', id: event.definitionId };
		case 'definition_version.created':
			return { kind: 'definition', id: event.definitionId };
		case 'definition_version.deleted':
			// No parent definition id on this variant — surface the version id
			// under the version kind so the UI doesn't try to resolve it as a
			// definition (which would always miss).
			return { kind: 'definition_version', id: event.versionId };
		case 'share_link.minted':
			return { kind: 'definition', id: event.definitionId };
		case 'share_link.revoked':
			return { kind: 'share_link', id: event.linkId };
		case 'invite.created':
		case 'invite.accepted':
		case 'invite.revoked':
			return { kind: 'org', id: event.orgId };
		case 'user.created':
		case 'user.deleted':
		case 'user.disabled':
		case 'platform_permissions.changed':
			return { kind: 'user', id: event.userId };
		case 'system.update.started':
		case 'system.update.finished':
		case 'system.update.rolled_back':
		case 'system.update.failed':
			// Instance-level events — there is no entity to resolve; the versions
			// and detail live in the row's expandable `data` payload.
			return null;
	}
}
