import { describe, it, expect } from 'vitest';
import { createRouteClassifier } from '../route-classifier.js';

// Invented routes, not Selva's real policy — that is pinned by the consuming
// app's own suite. Changing these values breaks nothing downstream.
const classifier = createRouteClassifier({
	publicPages: ['/', '/login'],
	publicPrefixes: ['/auth/', '/logout'],
	publicApis: ['/api/health'],
	selfGatingPrefix: '/api/files/',
	staticPrefixes: ['/_app/', '/favicon/'],
	staticPaths: ['/favicon.svg', '/robots.txt']
});

describe('createRouteClassifier', () => {
	it('classifies exact pages, API allowlist, prefixes, and self-gating as public', () => {
		for (const path of [
			'/',
			'/login',
			'/api/health',
			'/auth/oauth/callback',
			'/logout',
			'/api/files/orgs/abc/logo.webp'
		]) {
			expect(classifier.isPublicRoute(path)).toBe(true);
		}
	});

	it('denies by default — unknown routes are gated', () => {
		for (const path of ['/library', '/api/projects', '/billing', '/whatever']) {
			expect(classifier.isPublicRoute(path)).toBe(false);
		}
	});

	it('exact-match pages do not admit siblings via prefix', () => {
		expect(classifier.isPublicRoute('/login-other')).toBe(false);
		expect(classifier.isPublicRoute('/api/healthz')).toBe(false);
	});

	it('self-gating prefix is not a loose match', () => {
		expect(classifier.isSelfGatingApiRoute('/api/files/x')).toBe(true);
		expect(classifier.isSelfGatingApiRoute('/api/filesX/y')).toBe(false);
		expect(classifier.isSelfGatingApiRoute('/api/projects')).toBe(false);
	});

	it('recognizes static assets by prefix and exact path', () => {
		expect(classifier.isStaticAsset('/_app/immutable/x.js')).toBe(true);
		expect(classifier.isStaticAsset('/favicon/16.png')).toBe(true);
		expect(classifier.isStaticAsset('/robots.txt')).toBe(true);
		expect(classifier.isStaticAsset('/favicon-other.png')).toBe(false);
		expect(classifier.isStaticAsset('/login')).toBe(false);
	});

	it('every allowlist is optional — an empty config gates everything', () => {
		const closed = createRouteClassifier({});
		expect(closed.isPublicRoute('/')).toBe(false);
		expect(closed.isStaticAsset('/robots.txt')).toBe(false);
		expect(closed.isSelfGatingApiRoute('/api/files/x')).toBe(false);
	});
});
