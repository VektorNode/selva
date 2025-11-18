import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getValuesPath } from '$lib/utils/session-paths';
import { readJsonFile, writeJsonFile, fileExists } from '$lib/utils/file-io';

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getValuesPath(sessionId);

	if (!fileExists(filePath)) {
		return json({ timestamp: new Date().toISOString(), values: {} });
	}

	try {
		const data = readJsonFile(filePath);
		return json(data);
	} catch (error) {
		return json({ error: 'Failed to read values' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const values = await request.json();
	const filePath = getValuesPath(sessionId);

	try {
		writeJsonFile(filePath, values);
		return json({ success: true });
	} catch (error) {
		return json({ error: 'Failed to write values' }, { status: 500 });
	}
};
