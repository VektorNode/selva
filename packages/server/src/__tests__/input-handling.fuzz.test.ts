import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isApiError } from '../api/errors.js';
import { formText, parseBody, readForm, requireUpload } from '../api/request.js';
import { bearerOf } from '../http/api-token.js';
import { isCrossSiteFormSubmission } from '../http/csrf.js';
import { safeRedirectTarget } from '../http/redirect.js';
import {
	createOAuthServer,
	GRASSHOPPER_CLIENT_ID,
	isLoopbackRedirect,
	OAuthError
} from '../oauth/index.js';
import { z } from 'zod';

// FUZZ_RUNS=20000 for a deep run; the default keeps CI fast.
const RUNS = { numRuns: Number(process.env.FUZZ_RUNS ?? 300) };

const ORIGIN = 'https://selva.test';

/** Strings built from the characters URL and header parsers treat specially. */
const tricky = (chars: string[]) =>
	fc
		.array(fc.oneof(fc.constantFrom(...chars), fc.string({ maxLength: 3 })), { maxLength: 24 })
		.map((parts) => parts.join(''));

const URL_CHARS = [
	'/',
	'\\',
	'\t',
	'\n',
	'\r',
	' ',
	'%2F',
	'%5C',
	'%09',
	'@',
	':',
	'.',
	'?',
	'#',
	'evil.test',
	'\u0000',
	'／',
	'。',
	'http:',
	'javascript:'
];

/** The value when `run` succeeds, `'api-error'` when it throws ApiError; anything else escapes. */
async function apiOutcome(run: () => Promise<unknown> | unknown): Promise<unknown> {
	try {
		return await run();
	} catch (err) {
		if (isApiError(err)) return 'api-error';
		throw err;
	}
}

describe('safeRedirectTarget', () => {
	// Judged by the WHATWG parser browsers use, not by the function's own idea of a path.
	it('only ever returns a target on this origin', () => {
		fc.assert(
			fc.property(tricky(URL_CHARS), (raw) => {
				const target = safeRedirectTarget(raw, '/fallback');
				expect(new URL(target, ORIGIN).origin).toBe(ORIGIN);
			}),
			RUNS
		);
	});
});

describe('the CSRF exemption and key auth read the same bearer', () => {
	it('skips the Origin check only for a header key auth reads as a Selva key', () => {
		fc.assert(
			fc.property(
				tricky(['Bearer', 'bearer', ' ', '\t', 'selva_', 'abc', ',', 'Basic ']),
				(auth) => {
					let request: Request;
					try {
						request = new Request(`${ORIGIN}/login`, {
							method: 'POST',
							headers: {
								'content-type': 'application/x-www-form-urlencoded',
								origin: 'https://evil.test',
								authorization: auth
							},
							body: 'a=1'
						});
					} catch {
						return; // Not a header value fetch would ever send.
					}
					const exempt = !isCrossSiteFormSubmission(request);
					expect(exempt).toBe(bearerOf(request)?.startsWith('selva_') ?? false);
				}
			),
			RUNS
		);
	});
});

describe('request bodies', () => {
	const Schema = z.object({ versionId: z.string().optional() });

	it('parseBody answers any body with a value or an ApiError', async () => {
		await fc.assert(
			fc.asyncProperty(fc.oneof(fc.string(), fc.json()), async (body) => {
				const request = new Request(ORIGIN, { method: 'POST', body });
				await apiOutcome(() => parseBody(request, Schema, { missingAs: {} }));
			}),
			RUNS
		);
	});

	it('readForm and the upload helpers answer any multipart body with a value or an ApiError', async () => {
		const part = fc.record({
			name: fc.constantFrom('file', 'image', 'displayName', 'projectId', '"', ''),
			filename: fc.option(tricky(['.gh', '.ghx', '../', '\\', '"', '\r\n', 'a'])),
			type: fc.option(fc.constantFrom('image/png', 'application/octet-stream', 'text/plain', '')),
			body: fc.string({ maxLength: 40 })
		});
		await fc.assert(
			fc.asyncProperty(
				fc.array(part, { maxLength: 4 }),
				fc.constantFrom('BOUNDARY', 'B', ''),
				fc.boolean(),
				async (parts, boundary, close) => {
					const crlf = '\r\n';
					let body = parts
						.map((p) => {
							const disposition =
								`Content-Disposition: form-data; name="${p.name}"` +
								(p.filename === null ? '' : `; filename="${p.filename}"`);
							const type = p.type === null ? '' : `${crlf}Content-Type: ${p.type}`;
							return `--${boundary}${crlf}${disposition}${type}${crlf}${crlf}${p.body}${crlf}`;
						})
						.join('');
					if (close) body += `--${boundary}--${crlf}`;
					const request = new Request(ORIGIN, {
						method: 'POST',
						headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
						body
					});
					await apiOutcome(async () => {
						const form = await readForm(request);
						formText(form, 'displayName', { maxLength: 10 });
						return requireUpload(form, 'file', { maxBytes: 20, extensions: ['.gh', '.ghx'] });
					});
				}
			),
			RUNS
		);
	});
});

describe('OAuth authorize requests', () => {
	const oauth = createOAuthServer({ origin: ORIGIN, secret: 's'.repeat(32) });
	const registered = oauth.register({
		client_name: 'Fuzz',
		redirect_uris: ['https://client.test/cb']
	}).body.client_id as string;

	const param = (values: string[]) => fc.option(fc.oneof(fc.constantFrom(...values), fc.string()));

	// Anything but a clean refusal or a request inside the client's own limits is a bug.
	it('refuses with OAuthError, or stays inside what the client registered', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.record({
					response_type: param(['code']),
					client_id: param([registered, GRASSHOPPER_CLIENT_ID]),
					redirect_uri: param([
						'https://client.test/cb',
						'https://client.test/cb/../evil',
						'https://evil.test/cb',
						'http://127.0.0.1:9/callback',
						'http://127.0.0.1.evil.test/callback'
					]),
					code_challenge: param(['E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM']),
					code_challenge_method: param(['S256', 'plain']),
					scope: param(['read', 'solve', 'upload', 'read solve upload', 'foo']),
					state: param(['st']),
					resource: param([`${ORIGIN}/mcp`, 'https://other.test/mcp'])
				}),
				async (fields) => {
					const query = new URLSearchParams();
					for (const [k, v] of Object.entries(fields)) if (v !== null) query.set(k, v);
					let request;
					try {
						request = await oauth.parseAuthorizeRequest(query);
					} catch (err) {
						if (err instanceof OAuthError) return;
						throw err;
					}
					// Loopback redirects match on any port (RFC 8252 §7.3), and only those.
					const portless = (uri: string) => {
						const url = new URL(uri);
						if (isLoopbackRedirect(uri)) url.port = '';
						return url.href;
					};
					expect(request.client.redirectUris.map(portless)).toContain(
						portless(request.redirectUri)
					);
					for (const s of request.scopes) expect(request.client.scopes).toContain(s);
				}
			),
			RUNS
		);
	});
});
