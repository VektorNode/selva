import { describe, expect, it } from 'vitest';
import { normalizePlotlyColor, upgradePlotlyFigure } from '../plotly-compat';

describe('normalizePlotlyColor', () => {
	it.each([
		['ff0000', '#ff0000'],
		[' F00 ', '#F00'],
		['hsv(0, 100%, 100%)', 'rgb(255,0,0)'],
		['hsv(120, 1, 0.5)', 'rgb(0,128,0)'],
		['hsva(240, 100, 100, 0.5)', 'rgba(0,0,255,0.5)']
	])('rewrites %s', (input, expected) => {
		expect(normalizePlotlyColor(input)).toBe(expected);
	});

	it.each(['#ff0000', 'rgb(1,2,3)', 'red', 'Viridis'])('keeps %s', (input) => {
		expect(normalizePlotlyColor(input)).toBe(input);
	});
});

describe('upgradePlotlyFigure', () => {
	it('keeps scatter-matrix axes unlinked unless the figure says otherwise', () => {
		const out = upgradePlotlyFigure({
			data: [
				{
					type: 'splom',
					dimensions: [
						{ label: 'a', values: [1] },
						{ label: 'b', values: [2], axis: { matches: true } }
					]
				}
			]
		});
		const dims = out.data[0].dimensions as { axis: { matches: boolean } }[];
		expect(dims.map((d) => d.axis.matches)).toEqual([false, true]);
	});

	it('moves mapbox traces and layout to map', () => {
		const out = upgradePlotlyFigure({
			data: [{ type: 'scattermapbox', lat: [1], lon: [2], subplot: 'mapbox2' }],
			layout: { mapbox2: { style: 'stamen-terrain', accesstoken: 'pk.x', zoom: 3 } }
		});
		expect(out.data[0]).toMatchObject({ type: 'scattermap', subplot: 'map2' });
		expect(out.layout).toEqual({ map2: { style: 'open-street-map', zoom: 3 } });
	});

	it('normalizes colours in traces, layout and colorscales but not text', () => {
		const out = upgradePlotlyFigure({
			data: [
				{
					type: 'heatmap',
					colorscale: [
						[0, 'ffffff'],
						[1, 'hsv(0,1,1)']
					],
					colorbar: { title: { text: 'fed' } },
					marker: { color: ['00ff00', 'red', '100'] }
				}
			],
			layout: { paper_bgcolor: '000', title: { text: 'bad' } }
		});
		expect(out.data[0]).toMatchObject({
			colorscale: [
				[0, '#ffffff'],
				[1, 'rgb(255,0,0)']
			],
			colorbar: { title: { text: 'fed' } },
			marker: { color: ['#00ff00', 'red', '100'] }
		});
		expect(out.layout).toMatchObject({ paper_bgcolor: '#000', title: { text: 'bad' } });
	});

	it('leaves compatible figures and the input untouched', () => {
		const figure = {
			data: [{ type: 'bar', x: ['a'], y: [1], marker: { color: 'rgb(1,2,3)' } }],
			layout: { paper_bgcolor: '#fff' }
		};
		const snapshot = structuredClone(figure);
		expect(upgradePlotlyFigure(figure)).toEqual(figure);
		expect(figure).toEqual(snapshot);
	});
});
