import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStatePath } from '$lib/utils/session-paths';
import { readJsonFile, writeJsonFile, fileExists } from '$lib/utils/file-io';

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getStatePath(sessionId);

	if (!fileExists(filePath)) {
		return json({
			sessionId,
			active: false,
			lastUpdate: new Date().toISOString(),
			mode: 'builder'
		});
	}

	try {
		const data = readJsonFile(filePath);
		return json(data);
	} catch (error) {
		return json({ error: 'Failed to read state' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const state = await request.json();
	const filePath = getStatePath(sessionId);

	try {
		writeJsonFile(filePath, state);
		return json({ success: true });
	} catch (error) {
		return json({ error: 'Failed to write state' }, { status: 500 });
	}
};
