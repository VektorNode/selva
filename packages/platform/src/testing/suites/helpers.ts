import type { RequestContext } from '../../context.js';

export function makeCtx(
	userId: string,
	permissions: RequestContext['permissions'] = ['platform_admin']
): RequestContext {
	return { userId, permissions };
}

export function makeUuid(): string {
	return crypto.randomUUID();
}
