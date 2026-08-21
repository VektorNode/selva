/**
 * The API handlers themselves — the business logic behind each endpoint.
 *
 * A handler is `(req: ApiRequest) => Promise<ApiResponse | Response>` and names
 * no web framework: it reads params and body off `req`, reaches stores through
 * `req.deps`, and fails by throwing `ApiError`. A host binds one to a route by
 * building an `ApiRequest` and calling `runHandler` — see `api/README.md`.
 *
 * Handlers live here rather than in a host app so a second host implements the
 * same API by mounting these, not by reimplementing them and re-deriving the
 * gates, invariants, and status codes each one enforces.
 */

export { updateOrgMember, removeOrgMember } from './orgMembers.js';
