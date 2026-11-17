import type {
	IPlatformProjectGrantStore,
	PlatformProjectGrant,
	RequestContext
} from '@selvajs/platform';
import { ERASED_ACTOR_ID, ProviderError } from '@selvajs/platform';
import type { ClientBundle } from './client.js';
import { mapPostgrestError } from './errors.js';

const GRANT_COLUMNS = 'id, project_id, grantee_type, grantee_id, can_solve, created_by, created_at';

/** Reads go through the caller's client, so RLS shows a grantee only its own grants. */
export class SupabasePlatformProjectGrantStore implements IPlatformProjectGrantStore {
	constructor(private readonly clients: ClientBundle) {}

	async listByProject(ctx: RequestContext, projectId: string): Promise<PlatformProjectGrant[]> {
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('platform_project_grants')
			.select(GRANT_COLUMNS)
			.eq('project_id', projectId)
			.order('created_at', { ascending: true });
		if (error) throw mapPostgrestError(error);
		return (data ?? []).map(rowToGrant);
	}

	async listByProjects(
		ctx: RequestContext,
		projectIds: readonly string[]
	): Promise<Map<string, PlatformProjectGrant[]>> {
		const result = new Map(projectIds.map((id) => [id, [] as PlatformProjectGrant[]]));
		if (projectIds.length === 0) return result;
		const { data, error } = await this.clients
			.forRequest(ctx)
			.from('platform_project_grants')
			.select(GRANT_COLUMNS)
			.in('project_id', [...projectIds])
			.order('created_at', { ascending: true });
		if (error) throw mapPostgrestError(error);
		for (const row of data ?? []) {
			const grant = rowToGrant(row);
			result.get(grant.projectId)?.push(grant);
		}
		return result;
	}

	async create(_ctx: RequestContext, grant: PlatformProjectGrant): Promise<void> {
		const { error } = await this.clients.serviceClient
			.from('platform_project_grants')
			.insert(grantToRow(grant));
		if (error?.code === '23505' && error.message.includes('platform_project_grants_grantee_key')) {
			throw new ProviderError(
				`A grant for this ${grant.granteeType} already exists on this project`,
				409
			);
		}
		if (error) throw mapPostgrestError(error);
	}

	async delete(_ctx: RequestContext, id: string): Promise<void> {
		const { data, error } = await this.clients.serviceClient
			.from('platform_project_grants')
			.delete()
			.eq('id', id)
			.select('id');
		if (error) throw mapPostgrestError(error);
		if (!data || data.length === 0) throw new ProviderError(`Grant '${id}' not found`, 404);
	}

	async deleteByProject(_ctx: RequestContext, projectId: string): Promise<void> {
		const { error } = await this.clients.serviceClient
			.from('platform_project_grants')
			.delete()
			.eq('project_id', projectId);
		if (error && !isMissingTable(error)) throw mapPostgrestError(error);
	}

	async deleteByGranteeOrg(_ctx: RequestContext, orgId: string): Promise<void> {
		const { error } = await this.clients.serviceClient
			.from('platform_project_grants')
			.delete()
			.eq('grantee_type', 'org')
			.eq('grantee_id', orgId);
		if (error && !isMissingTable(error)) throw mapPostgrestError(error);
	}

	/** A user grant is the user's own, so it goes with them; one they created stays. */
	async eraseUser(userId: string): Promise<void> {
		const client = this.clients.serviceClient;
		const deleted = await client
			.from('platform_project_grants')
			.delete()
			.eq('grantee_type', 'user')
			.eq('grantee_id', userId);
		if (deleted.error) {
			if (isMissingTable(deleted.error)) return;
			throw mapPostgrestError(deleted.error);
		}
		const anonymized = await client
			.from('platform_project_grants')
			.update({ created_by: null })
			.eq('created_by', userId);
		if (anonymized.error) throw mapPostgrestError(anonymized.error);
	}
}

/**
 * Deleting an org, a project or a user runs these cleanups on every deployment, also one whose
 * database is still behind `20261117200000`, which the migration handshake lets boot. Without the
 * table there is nothing to clean up.
 */
function isMissingTable(error: { code?: string }): boolean {
	return error.code === 'PGRST205' || error.code === '42P01';
}

interface GrantRow {
	id: string;
	project_id: string;
	grantee_type: PlatformProjectGrant['granteeType'];
	grantee_id: string;
	can_solve: boolean;
	created_by: string | null;
	created_at: string;
}

function rowToGrant(row: GrantRow): PlatformProjectGrant {
	return {
		id: row.id,
		projectId: row.project_id,
		granteeType: row.grantee_type,
		granteeId: row.grantee_id,
		canSolve: row.can_solve,
		createdBy: row.created_by ?? ERASED_ACTOR_ID,
		createdAt: row.created_at
	};
}

function grantToRow(g: PlatformProjectGrant): GrantRow {
	return {
		id: g.id,
		project_id: g.projectId,
		grantee_type: g.granteeType,
		grantee_id: g.granteeId,
		can_solve: g.canSolve,
		created_by: g.createdBy === ERASED_ACTOR_ID ? null : g.createdBy,
		created_at: g.createdAt
	};
}
