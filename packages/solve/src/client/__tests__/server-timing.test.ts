import { describe, it, expect } from 'vitest';
import { buildServerTiming } from '../../server/server-timing.js';
import { describeServerTiming } from '../server-timing.js';

const parts = {
	defLoadMs: 0,
	treeBuildMs: 2.4,
	solveMs: 6900,
	serializeMs: 150,
	gzipMs: 36,
	serverTotalMs: 7399,
	rhino: null,
	settle: { fromCache: false },
	prepMarks: []
};

describe('describeServerTiming', () => {
	it('splits the Compute call when the server reports its own timing', () => {
		const header = buildServerTiming({
			...parts,
			rhino: {
				decode: 12,
				solve: 6300,
				encode: 540,
				gh: 6100,
				recomputed: { ran: 412, total: 980 }
			} as never,
			settle: { fromCache: false, definitionReuploaded: true },
			defBytes: 'miss',
			prepMarks: [
				['body', 0.4],
				['access', 12],
				['blob', 280]
			]
		});

		expect(describeServerTiming(header)).toBe(
			'compute 6900: solve 6300 (grasshopper 6100), decode 12, encode 540, queue+link 48 | ' +
				'prep 292: blob 280, access 12 | tree 2 | serialize 150 | gzip 36 | ' +
				'definition re-sent to Compute | recomputed 412/980 | def_bytes miss'
		);
	});

	it('gives the Compute call as one number for a server that reports none', () => {
		expect(describeServerTiming(buildServerTiming(parts))).toBe(
			'compute 6900 | tree 2 | serialize 150 | gzip 36'
		);
	});

	it('has nothing to say without a solve entry', () => {
		expect(describeServerTiming(null)).toBeNull();
		expect(describeServerTiming('affinity;desc=hit')).toBeNull();
	});
});
