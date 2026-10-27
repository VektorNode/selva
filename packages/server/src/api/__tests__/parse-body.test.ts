import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseBody, readForm } from '../request.js';
import { isApiError } from '../errors.js';

const post = (body: string, type = 'application/json') =>
	new Request('http://test.local/', { method: 'POST', headers: { 'content-type': type }, body });

const Publish = z.object({ versionId: z.string().optional() });

async function status(run: () => Promise<unknown>): Promise<number | 'ok'> {
	try {
		await run();
		return 'ok';
	} catch (err) {
		if (isApiError(err)) return err.status;
		throw err;
	}
}

describe('parseBody', () => {
	it('reads an empty body as `missingAs`', async () => {
		await expect(parseBody(post(''), Publish, { missingAs: {} })).resolves.toEqual({});
	});

	// Read as `{}`, a truncated rollback body would publish the draft instead.
	it('refuses broken JSON even where an empty body is allowed', async () => {
		expect(
			await status(() => parseBody(post('{"versionId":"v1"'), Publish, { missingAs: {} }))
		).toBe(400);
	});
});

describe('readForm', () => {
	it('answers a body that is not a form with 400, not a raw TypeError', async () => {
		expect(await status(() => readForm(post('not a form', 'multipart/form-data')))).toBe(400);
	});
});
