export interface IdentityPageData {
	user?: { id: string; email?: string } | null;
	profile?: { displayName?: string } | null;
	hasProxyAuth?: boolean;
}

export function userLabel(data: IdentityPageData): string {
	return data.profile?.displayName ?? data.user?.email?.split('@')[0] ?? data.user?.id ?? '';
}

/** Forward-auth deployments have no Selva session: sign-out is the proxy/IdP's job. */
export function canLogOut(data: IdentityPageData): boolean {
	return !data.hasProxyAuth;
}
