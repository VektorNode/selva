import { describe, it, expect } from 'vitest';
import type { ServerTiming } from '@selvajs/compute/core';
import { buildServerTiming } from '../server-timing.js';

function header(over: Partial<Parameters<typeof buildServerTiming>[0]> = {}) {
	return buildServerTiming({
		defLoadMs: 0,
		treeBuildMs: 0,
		solveMs: 40,
		serializeMs: 0,
		gzipMs: 0,
		serverTotalMs: 0,
		rhino: null,
		settle: { fromCache: false },
		prepMarks: [],
		...over
	});
}

describe('buildServerTiming', () => {
	it('emits the core phases and echoes prep marks as p_*', () => {
		const st = header({
			defLoadMs: 12.3,
			prepMarks: [
				['body', 0.5],
				['client', 3.1]
			]
		});
		expect(st).toContain('load;dur=12.3');
		for (const phase of ['tree', 'solve', 'serialize', 'gzip', 'total']) {
			expect(st).toContain(`${phase};dur=`);
		}
		expect(st).toContain('p_body;dur=0.5');
		expect(st).toContain('p_client;dur=3.1');
	});

	it('splits solve into rhino_* + compute_link when the call reported server timing', () => {
		const rhino: ServerTiming = { decode: 5, solve: 20, encode: 3, raw: '' };
		const st = header({ rhino });
		expect(st).toContain('rhino_decode;dur=5.0');
		expect(st).toContain('rhino_solve;dur=20.0');
		expect(st).toContain('rhino_encode;dur=3.0');
		expect(st).toContain('compute_link;dur=12.0');
	});

	it("forwards the compute server's gh time, recomputed count and result-cache verdict", () => {
		const st = header({
			rhino: { solve: 20, gh: 18, recomputed: { ran: 4, total: 97 }, raw: '' }
		});
		expect(st).toContain('rhino_gh;dur=18.0');
		expect(st).toContain('rhino_recomputed;desc="4/97"');
		expect(st).toContain('rhino_cache;dur=0');

		const hit = header({ rhino: { cacheHit: true, raw: '' } });
		expect(hit).toContain('rhino_cache;dur=1');
		expect(hit).toContain('rhino_solve;dur=0.0');
	});

	it('surfaces selva_cache + def_reupload verdicts as 0/1 flags', () => {
		const st = header({ settle: { fromCache: true, definitionReuploaded: false } });
		expect(st).toContain('selva_cache;dur=1');
		expect(st).toContain('def_reupload;dur=0');
	});

	it('omits what the solve did not report', () => {
		const st = header();
		expect(st).toContain('selva_cache;dur=0');
		expect(st).not.toContain('def_reupload');
		expect(st).not.toContain('rhino_decode');
		expect(st).not.toContain('def_bytes');
	});

	it('names the definition-bytes verdict', () => {
		expect(header({ defBytes: 'skipped' })).toContain('def_bytes;desc=skipped');
	});
});
