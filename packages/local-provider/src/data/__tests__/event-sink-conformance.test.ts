import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runEventSinkConformance, type RecordingEventSink } from '@selvajs/platform/testing';
import { LocalDataProvider } from '../LocalDataProvider.js';

const tempDirs: string[] = [];

runEventSinkConformance({
	name: 'LocalDataProvider',
	createProvider: async (sink: RecordingEventSink) => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-events-'));
		tempDirs.push(tempDir);
		return LocalDataProvider.fromEnv(
			{
				DATA_PATH: tempDir,
				SELVA_SECRET_KEY: '0'.repeat(64)
			},
			sink
		);
	},
	createActorId: async () => ({ userId: randomUUID() }),
	cleanup: async () => {
		await Promise.all(tempDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
		tempDirs.length = 0;
	}
});
