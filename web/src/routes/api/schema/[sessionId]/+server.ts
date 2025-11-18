import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSchemaPath } from '$lib/utils/session-paths';
import { readJsonFile, writeJsonFile, fileExists } from '$lib/utils/file-io';

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getSchemaPath(sessionId);

	if (!fileExists(filePath)) {
		return json({ error: 'Schema not found' }, { status: 404 });
	}

	try {
		const data = readJsonFile(filePath);
		return json(data);
	} catch (error) {
		return json({ error: 'Failed to read schema' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const schema = await request.json();
	const filePath = getSchemaPath(sessionId);

	try {
		writeJsonFile(filePath, schema);
		return json({ success: true });
	} catch (error) {
		return json({ error: 'Failed to write schema' }, { status: 500 });
	}
};
