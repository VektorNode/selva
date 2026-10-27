/**
 * This instance's OAuth authorization server for MCP clients. The protocol lives
 * in `@selvajs/server/oauth`; this file supplies the secret, the SSRF-guarded
 * metadata fetch and the per-IP limit the endpoints share.
 */

import { json, type RequestEvent } from '@sveltejs/kit';
import { env } from '#lib/server/env.js';
import {
	assertSafeRemoteDefinitionUrl,
	createComputeRateLimiter,
	readBodyWithCap
} from '@selvajs/server/compute';
import { createOAuthServer, type OAuthServer } from '@selvajs/server/oauth';
import { MIN_TOKEN_SECRET_LENGTH } from '@selvajs/server/tokens';

const METADATA_TIMEOUT_MS = 5_000;
const METADATA_MAX_BYTES = 64 * 1024;

// One slot, as for `/mcp`: the origin comes from the request, so a map would grow
// with whatever hosts a caller sends. Re-keyed on the secret, like the token codecs.
let cached: { origin: string; secret: string; server: OAuthServer } | null = null;
// Outlives `cached`, so rebuilding the server for another origin can't forget a redeemed code.
const redeemedCodes = new Map<string, number>();

/** Undefined without a usable SELVA_HMAC_KEY: the endpoints then answer 503. */
export function oauthServer(origin: string): OAuthServer | undefined {
	const secret = env.SELVA_HMAC_KEY;
	if (!secret || secret.length < MIN_TOKEN_SECRET_LENGTH) return undefined;
	if (cached?.origin !== origin || cached.secret !== secret) {
		cached = {
			origin,
			secret,
			server: createOAuthServer({ origin, secret, fetchClientMetadata, redeemedCodes })
		};
	}
	return cached.server;
}

/** The URL is an unknown client's, so it goes through the same guard as remote definitions. */
async function fetchClientMetadata(url: string): Promise<unknown> {
	await assertSafeRemoteDefinitionUrl(url);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			redirect: 'error',
			signal: controller.signal
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		// Counted while streaming: a body with no or a lying Content-Length must not buffer whole.
		const bytes = await readBodyWithCap(res, METADATA_MAX_BYTES, controller);
		return JSON.parse(new TextDecoder().decode(bytes));
	} finally {
		clearTimeout(timer);
	}
}

// Registration and token exchange take no credential, so the IP is the only key.
const limiter = createComputeRateLimiter({ windowMs: 60_000, maxPerWindow: 30 });

/** A 429 response when the caller's IP is over the limit, else undefined. */
export function oauthRateLimited(event: RequestEvent): Response | undefined {
	const verdict = limiter.check(`oauth:${event.getClientAddress()}`);
	if (verdict.allowed) return undefined;
	return json(
		{ error: 'slow_down', error_description: 'Too many requests. Try again shortly.' },
		{ status: 429, headers: { 'Retry-After': String(verdict.retryAfter ?? 60) } }
	);
}

export function oauthUnavailable(): Response {
	return json(
		{ error: 'temporarily_unavailable', error_description: 'OAuth is not configured here.' },
		{ status: 503 }
	);
}

/** Discovery documents are read by browser-based clients too. */
export const DISCOVERY_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Cache-Control': 'public, max-age=3600'
};
