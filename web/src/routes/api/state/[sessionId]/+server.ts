import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getTempDir = () => join(tmpdir(), 'ComputeBuilder');
const getStatePath = (sessionId: string) => join(getTempDir(), `${sessionId}_state.json`);

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getStatePath(sessionId);

	if (!existsSync(filePath)) {
		return json({
			sessionId,
			active: false,
			lastUpdate: new Date().toISOString(),
			mode: 'builder'
		});
	}

	try {
		const data = readFileSync(filePath, 'utf-8');
		return json(JSON.parse(data));
	} catch (error) {
		return json({ error: 'Failed to read state' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const state = await request.json();
	const filePath = getStatePath(sessionId);

	try {
		writeFileSync(filePath, JSON.stringify(state, null, 2));
		return json({ success: true });
	} catch (error) {
		return json({ error: 'Failed to write state' }, { status: 500 });
	}
};
