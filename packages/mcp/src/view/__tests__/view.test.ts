import { describe, expect, it } from 'vitest';
import { SOLVE_VIEW_KEY } from '../../app.js';
import { loadSolveResponse, resultText, solveViewData, type App } from '../index.js';

const response = { modelunits: 'Millimeters', values: [] };

function fakeApp(result: unknown) {
	const calls: unknown[] = [];
	const app = {
		callServerTool: async (params: unknown) => {
			calls.push(params);
			return result;
		}
	} as unknown as App;
	return { app, calls };
}

describe('solve view data', () => {
	it('reads what a tool hands the view, and the text when there is none', () => {
		const result = {
			content: [
				{ type: 'text', text: 'Solved.' },
				{ type: 'image', data: 'x', mimeType: 'image/png' }
			],
			_meta: { [SOLVE_VIEW_KEY]: { title: 'Wall' } }
		};
		expect(solveViewData(result)).toEqual({ title: 'Wall' });
		expect(resultText(result)).toBe('Solved.');
		expect(solveViewData({ content: [] })).toBeUndefined();
	});

	it('draws inline geometry without calling a tool', async () => {
		const { app, calls } = fakeApp(undefined);
		expect(await loadSolveResponse(app, { response })).toBe(response);
		expect(calls).toEqual([]);
	});

	it('calls the load tool for geometry the first result left out', async () => {
		const { app, calls } = fakeApp({ content: [], _meta: { [SOLVE_VIEW_KEY]: { response } } });
		const load = { tool: 'job_geometry', arguments: { job: 'O62-1' } };
		expect(await loadSolveResponse(app, { load })).toBe(response);
		expect(calls).toEqual([{ name: 'job_geometry', arguments: { job: 'O62-1' } }]);
	});

	it('names the load tool’s own error', async () => {
		const { app } = fakeApp({ isError: true, content: [{ type: 'text', text: 'No release.' }] });
		await expect(loadSolveResponse(app, { load: { tool: 'job_geometry' } })).rejects.toThrow(
			'No release.'
		);
	});
});
