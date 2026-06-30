import { describe, it, expect } from 'vitest';
import { isPublicRoute, isStaticAsset, isSelfGatingApiRoute } from '../hooks.server.js';

/**
 * `hooks.server.ts` runs deny-by-default: any path not classified as public
 * or a static asset requires a session. These tests pin the classification
 * for high-stakes paths so a refactor of the allowlists can't silently
 * flip a gated route public (or vice versa).
 *
 * The lists are short and obvious enough that exhaustive coverage isn't
 * the goal — the goal is "if this test goes red, the auth boundary moved."
 */
describe('isPublicRoute', () => {
	it.each([
		['/'],
		['/login'],
		['/setup'],
		['/accept-invite'],
		['/logout'],
		['/logout/'], // form action also matches the prefix
		['/auth/supabase/start'],
		['/auth/supabase/callback'],
		['/api/health'],
		// The blob proxy is self-gating: it must pass the hook so it can apply
		// per-asset-class auth itself (public branding for guests, 401 for
		// org/project assets without a session).
		['/api/files/orgs/abc/branding/logo.webp'],
		['/api/files/definitions/00000000-0000-0000-0000-000000000000/cover.webp']
	])('classifies %j as public', (path) => {
		expect(isPublicRoute(path)).toBe(true);
	});

	it.each([
		// Authenticated app surfaces.
		['/library'],
		['/library/abc-guid'],
		['/projects'],
		['/admin'],
		['/admin/users'],
		// Authenticated APIs (every /api/* except /api/health).
		['/api/projects'],
		['/api/definitions'],
		['/api/compute'],
		['/api/invites'],
		['/admin/api/users'],
		['/admin/api/orgs'],
		// Unknown future routes inherit "gated".
		['/billing'],
		['/billing/invoice/123'],
		['/help'],
		['/whatever']
	])('classifies %j as NOT public (deny-by-default)', (path) => {
		expect(isPublicRoute(path)).toBe(false);
	});

	it('treats /api/files as self-gating, not other /api routes', () => {
		expect(isSelfGatingApiRoute('/api/files/orgs/abc/branding/logo.webp')).toBe(true);
		expect(isSelfGatingApiRoute('/api/files/anything')).toBe(true);
		expect(isSelfGatingApiRoute('/api/projects')).toBe(false);
		expect(isSelfGatingApiRoute('/api/health')).toBe(false);
		// `/api/filesX` must not be admitted by a loose prefix.
		expect(isSelfGatingApiRoute('/api/filesX/y')).toBe(false);
	});

	it('does not treat /loginX as public via prefix match', () => {
		// /login is exact-match in PUBLIC_PAGE_ROUTES — a sibling like
		// /login-other-thing must not be admitted by accident.
		expect(isPublicRoute('/login-other')).toBe(false);
		expect(isPublicRoute('/setupX')).toBe(false);
	});
});

describe('isStaticAsset', () => {
	it.each([
		['/_app/immutable/chunks/x.js'],
		['/favicon/16.png'],
		['/favicon.svg'],
		['/robots.txt']
	])('classifies %j as a static asset', (path) => {
		expect(isStaticAsset(path)).toBe(true);
	});

	it.each([['/'], ['/login'], ['/api/projects'], ['/_admin/something'], ['/favicon-other.png']])(
		'classifies %j as NOT a static asset',
		(path) => {
			expect(isStaticAsset(path)).toBe(false);
		}
	);
});
