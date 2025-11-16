import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getTempDir = () => join(tmpdir(), 'ComputeBuilder');
const getValuesPath = (sessionId: string) => join(getTempDir(), `${sessionId}_values.json`);

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getValuesPath(sessionId);

	if (!existsSync(filePath)) {
		return json({ timestamp: new Date().toISOString(), values: {} });
	}

	try {
		const data = readFileSync(filePath, 'utf-8');
		return json(JSON.parse(data));
	} catch (error) {
		return json({ error: 'Failed to read values' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const values = await request.json();
	const filePath = getValuesPath(sessionId);

	try {
		writeFileSync(filePath, JSON.stringify(values, null, 2));
		return json({ success: true });
	} catch (error) {
		return json({ error: 'Failed to write values' }, { status: 500 });
	}
};
