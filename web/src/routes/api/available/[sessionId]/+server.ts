import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAvailablePath } from '$lib/utils/session-paths';
import { readJsonFile, fileExists } from '$lib/utils/file-io';

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getAvailablePath(sessionId);

	if (!fileExists(filePath)) {
		return json({
			sessionId,
			timestamp: new Date().toISOString(),
			parameters: []
		});
	}

	try {
		const data = readJsonFile(filePath);
		return json(data);
	} catch (error) {
		return json({ error: 'Failed to read available parameters' }, { status: 500 });
	}
};
