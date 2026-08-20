/**
 * Response schemas for the v1 payloads that must not carry a stored secret.
 *
 * Three store types hold a credential next to fields a client legitimately
 * reads: `ShareLink.tokenHash` and `Invite.tokenHash` are HMACs of a token,
 * `ComputeServerCommon.apiKey` is a live Rhino.Compute key. Handlers used to
 * strip them by destructuring — `const { tokenHash: _omit, ...rest } = invite`
 * — which works until someone adds a field to the stored type or edits the line
 * away. Nothing fails at build time; the credential just starts appearing in a
 * response.
 *
 * Parsing through these schemas inverts the default: the response carries only
 * what the schema names, so a new field on the stored type is invisible to
 * clients until added here on purpose. Use them via `shaped`/`shapedCollection`
 * in `./route.ts`.
 *
 * These describe **responses**, not stored records — where the two differ (an
 * invite's one-time `acceptUrl`, a share link's `hasToken` sentinel) the
 * response is the authority.
 */

import { z } from 'zod';

// ============================================================================
// Share links
// ============================================================================

export const ShareLinkResponseSchema = z.object({
	id: z.string(),
	definitionId: z.string(),
	channel: z.enum(['live', 'draft']),
	name: z.string().optional(),
	createdBy: z.string(),
	createdAt: z.string(),
	expiresAt: z.string().nullish(),
	revokedAt: z.string().nullish(),
	allowSolve: z.boolean(),
	maxSolves: z.number().nullish(),
	solveCount: z.number(),
	/** Sentinel replacing `tokenHash`: a token exists, its hash is not yours. */
	hasToken: z.literal(true)
});

export type ShareLinkResponse = z.infer<typeof ShareLinkResponseSchema>;

/** The mint response. `token` is the plaintext, returned exactly once. */
export const CreatedShareLinkResponseSchema = z.object({
	link: ShareLinkResponseSchema,
	token: z.string()
});

// ============================================================================
// Invites
// ============================================================================

export const InviteResponseSchema = z.object({
	id: z.string(),
	email: z.string(),
	orgId: z.string(),
	orgRole: z.string(),
	orgPermissions: z.array(z.string()),
	platformPermissions: z.array(z.string()).default([]),
	invitedBy: z.string(),
	createdAt: z.string(),
	expiresAt: z.string(),
	acceptedAt: z.string().optional(),
	acceptedByUserId: z.string().optional()
});

/** The create response: the invite plus the link to send, built per request. */
export const CreatedInviteResponseSchema = InviteResponseSchema.extend({
	acceptUrl: z.string()
});

// ============================================================================
// Org compute
// ============================================================================

/**
 * An org-owned compute server. `apiKey` is replaced by `hasApiKey`, so a picker
 * can render "key set" without any store decrypting a secret to throw away.
 */
export const OrgComputeServerResponseSchema = z.object({
	id: z.string(),
	label: z.string(),
	serverUrl: z.string(),
	scope: z.literal('org'),
	ownerOrgId: z.string(),
	timeoutMs: z.number().optional(),
	retryCount: z.number().optional(),
	hasApiKey: z.boolean()
});

/** A server this org may select but not edit. Never carries a key either. */
export const ComputeCatalogEntrySchema = z.object({
	id: z.string(),
	label: z.string(),
	serverUrl: z.string(),
	scope: z.enum(['platform', 'org']),
	source: z.enum(['platform', 'org']),
	timeoutMs: z.number().optional(),
	retryCount: z.number().optional()
});

export const OrgComputeResponseSchema = z.object({
	servers: z.array(OrgComputeServerResponseSchema),
	defaultServerId: z.string().nullish(),
	globalDefaultServerId: z.string().nullish(),
	catalog: z.array(ComputeCatalogEntrySchema)
});
