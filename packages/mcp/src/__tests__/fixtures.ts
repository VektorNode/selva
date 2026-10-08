import { z } from 'zod';
import { buildOpenApiDocument, type Endpoint } from '@selvajs/server/api';

// Built with the real builder: the engine must read exactly what hosts emit.
const ENDPOINTS: Endpoint[] = [
	{
		method: 'GET',
		path: '/openapi.json',
		scope: 'read',
		summary: 'This document.',
		response: 'object'
	},
	{
		method: 'GET',
		path: '/orders',
		scope: 'read',
		summary: 'List orders.',
		response: 'collection',
		query: [{ name: 'externalRef', description: 'ERP reference.' }]
	},
	{ method: 'GET', path: '/orders/{id}', scope: 'read', summary: 'One order.', response: 'object' },
	{
		method: 'POST',
		path: '/orders',
		scope: 'write',
		idempotent: true,
		summary: 'Create an order.',
		response: 'object',
		status: 201,
		requestBody: z.object({ name: z.string(), notes: z.string().optional() })
	},
	{ method: 'DELETE', path: '/orders/{id}', scope: 'write', summary: 'Delete.', response: 'empty' },
	{
		method: 'POST',
		path: '/jobs/{id}/solve',
		scope: 'solve',
		idempotent: true,
		summary: 'Solve and release.',
		response: 'object'
	},
	{
		method: 'POST',
		path: '/uploads',
		scope: 'write',
		summary: 'Upload.',
		response: 'object',
		multipart: [{ field: 'file', required: true, description: 'File.' }]
	},
	{
		method: 'GET',
		path: '/secret',
		scope: 'read',
		internal: true,
		summary: 'UI only.',
		response: 'object'
	}
];

export const SPEC = buildOpenApiDocument(ENDPOINTS, {
	basePath: '/api/v1',
	info: { title: 'Test', version: '1.0.0', description: '' },
	securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
	security: [{ bearerAuth: [] }]
});

export const KEY = 'selva_test_secret';

export interface Recorded {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: unknown;
}

/** A fetch that records requests and answers from a queue, in order. */
export function fakeFetch(responses: (Response | Error)[]) {
	const calls: Recorded[] = [];
	const fn = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({
			method: init?.method ?? 'GET',
			url: String(input),
			headers: init?.headers as Record<string, string>,
			body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
		});
		const next = responses.shift();
		if (!next) throw new Error('fakeFetch: no response queued');
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return { fetch: fn, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers }
	});
