import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getServerConfig } from '$lib/server/config.server';

interface ValidatedSchema {
	name: string;
	description: string;
	author: string;
	inputCount: number;
	outputCount: number;
	tags: string[];
}

interface FileValidationResult {
	fileName: string;
	valid: boolean;
	error?: string;
	schemas?: ValidatedSchema[];
}

export const POST: RequestHandler = async ({ request }) => {
	const config = getServerConfig();
	const formData = await request.formData();

	const validateUrl = new URL('/grasshopper/validate', config.computeServerUrl).toString();

	const headers: Record<string, string> = {};
	if (config.computeApiKey) {
		headers['RhinoComputeKey'] = config.computeApiKey;
	}

	let response: Response;
	try {
		response = await fetch(validateUrl, {
			method: 'POST',
			headers,
			body: formData
		});

	} catch {
		// Compute server unreachable — validation not available
		throw error(404, 'Validation endpoint not available');
	}

	if (response.status === 404 || response.status === 405 || response.status === 500) {
		// Compute server doesn't support this endpoint — treat as unavailable
		throw error(404, 'Validation endpoint not available');
	}

	if (!response.ok) {
		// Compute server returned an error — surface it as a validation failure
		let errorMessage = `Compute server error (${response.status})`;
		try {
			const text = await response.text();
			if (text) errorMessage = text;
		} catch {
			// ignore
		}
		return json([{ fileName: '', valid: false, error: errorMessage }]);
	}

	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		throw error(502, 'Compute server returned invalid JSON');
	}

	// Normalize: compute server may return a single object or an array
	const rawArray: unknown[] = Array.isArray(raw) ? raw : [raw];

	const results: FileValidationResult[] = rawArray.map((raw) => {
		const item = raw as Record<string, unknown>;
		const result: FileValidationResult = {
			fileName: String(item.fileName ?? ''),
			valid: Boolean(item.valid)
		};

		if (!result.valid) {
			result.error = String(item.error ?? 'Unknown validation error');
		} else if (Array.isArray(item.schemas)) {
			result.schemas = item.schemas.map((s: Record<string, unknown>) => ({
				name: String(s.name ?? ''),
				description: String(s.description ?? ''),
				author: String(s.author ?? ''),
				inputCount: Number(s.inputCount ?? 0),
				outputCount: Number(s.outputCount ?? 0),
				tags: Array.isArray(s.tags) ? s.tags.map(String) : []
			}));
		}

		return result;
	});


	return json(results);
};
