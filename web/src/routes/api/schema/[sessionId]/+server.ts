import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getTempDir = () => join(tmpdir(), 'ComputeBuilder');
const getSchemaPath = (sessionId: string) => join(getTempDir(), `${sessionId}_schema.json`);

export const GET: RequestHandler = async ({ params }) => {
	const { sessionId } = params;
	const filePath = getSchemaPath(sessionId);

	if (!existsSync(filePath)) {
		return json({ error: 'Schema not found' }, { status: 404 });
	}

	try {
		const data = readFileSync(filePath, 'utf-8');
		return json(JSON.parse(data));
	} catch (error) {
		return json({ error: 'Failed to read schema' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { sessionId } = params;
	const schema = await request.json();
	const filePath = getSchemaPath(sessionId);

	try {
		writeFileSync(filePath, JSON.stringify(schema, null, 2));
		return json({ success: true });
	} catch (error) {
		return json({ error: 'Failed to write schema' }, { status: 500 });
	}
};
