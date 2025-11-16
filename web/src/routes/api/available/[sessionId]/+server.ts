import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getTempDir = () => join(tmpdir(), 'ComputeBuilder');
const getAvailablePath = (sessionId: string) => join(getTempDir(), `${sessionId}_available.json`);

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getAvailablePath(sessionId);

	if (!existsSync(filePath)) {
		return json({
			sessionId,
			timestamp: new Date().toISOString(),
			parameters: []
		});
	}

	try {
		const data = readFileSync(filePath, 'utf-8');
		return json(JSON.parse(data));
	} catch (error) {
		return json({ error: 'Failed to read available parameters' }, { status: 500 });
	}
};
