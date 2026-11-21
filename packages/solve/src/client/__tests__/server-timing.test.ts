import { describe, it, expect } from 'vitest';
import { buildServerTiming } from '../../server/server-timing.js';
import { describeComputeProfile, describeServerTiming } from '../server-timing.js';
import { computeProfileHeader } from '../../server/server-timing.js';

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
				wait: 30,
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
			'compute 6900: solve 6300 (grasshopper 6100), decode 12, encode 540, queue+link 48 ' +
				'(waiting for a free child 30) | ' +
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

describe('describeComputeProfile', () => {
	it('names each slow component with its nickname when it has its own', () => {
		const header = computeProfileHeader([
			{ name: 'Mesh Brep', nick: 'Fine mesh', ms: 21400 },
			{ name: 'Solid Union', nick: 'Solid Union', ms: 5200 }
		]);
		expect(describeComputeProfile(header)).toBe('Mesh Brep "Fine mesh" 21400, Solid Union 5200');
	});

	it('keeps non-ASCII names readable after the ASCII-only header', () => {
		const header = computeProfileHeader([{ name: 'Fläche', nick: '面', ms: 3 }]);
		expect([...header].every((c) => c.charCodeAt(0) < 0x80)).toBe(true);
		expect(describeComputeProfile(header)).toBe('Fläche "面" 3');
	});

	it('has nothing to say without a usable header', () => {
		expect(describeComputeProfile(null)).toBeNull();
		expect(describeComputeProfile('not json')).toBeNull();
		expect(describeComputeProfile('[]')).toBeNull();
	});

	it('drops entries that are not { name, ms } instead of throwing', () => {
		expect(describeComputeProfile('[null, 1, {"name": "x"}]')).toBeNull();
		expect(describeComputeProfile('[null, {"name": "Loft", "ms": 40}]')).toBe('Loft 40');
	});
});
