import { hsvToRgb } from '#lib/utils/color-space.js';

// ============================================================================
// Plotly 3 → 4 figure compatibility
// ============================================================================
//
// Chart outputs come from whatever plugin version solved them, often one written against
// Plotly 3. This rewrites the parts Plotly 4 draws differently or rejects, so those figures
// keep their look. Figures that are already compatible pass through unchanged.

type Json = Record<string, unknown>;

export interface PlotlyFigure {
	data: Json[];
	layout?: Json;
	config?: Json;
	frames?: Json[];
}

const REMOVED_MAP_TRACES: Record<string, string> = {
	scattermapbox: 'scattermap',
	choroplethmapbox: 'choroplethmap',
	densitymapbox: 'densitymap'
};

const MAPBOX_SUBPLOT = /^mapbox(\d*)$/;
const BARE_HEX = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HSV_FUNCTION =
	/^hsva?[\s(]+([-+\d.]+)%?[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?[\s)]*$/i;

const isObject = (v: unknown): v is Json =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns a rewritten copy; the input is not modified. */
export function upgradePlotlyFigure(figure: PlotlyFigure): PlotlyFigure {
	const out = structuredClone(figure);
	const layout = out.layout ?? {};
	normalizeColors(layout);

	let migratedMaps = false;
	for (const trace of out.data ?? []) {
		if (!isObject(trace)) continue;
		normalizeColors(trace);

		const replacement = REMOVED_MAP_TRACES[trace.type as string];
		if (replacement) {
			trace.type = replacement;
			if (typeof trace.subplot === 'string')
				trace.subplot = trace.subplot.replace(MAPBOX_SUBPLOT, 'map$1');
			migratedMaps = true;
		} else if (trace.type === 'splom') {
			keepSplomAxesUnlinked(trace);
		}
	}

	if (migratedMaps) migrateMapLayout(layout);
	// Frame data replaces trace data during playback, so it needs the same colour fixes.
	for (const frame of out.frames ?? []) if (isObject(frame)) normalizeColors(frame);
	return { ...out, layout };
}

// Plotly 4 links each dimension's x and y axes by default.
function keepSplomAxesUnlinked(trace: Json) {
	if (!Array.isArray(trace.dimensions)) return;
	for (const dim of trace.dimensions) {
		if (!isObject(dim)) continue;
		const axis = isObject(dim.axis) ? dim.axis : (dim.axis = {});
		if (!('matches' in axis)) axis.matches = false;
	}
}

function migrateMapLayout(layout: Json) {
	for (const key of Object.keys(layout)) {
		const match = MAPBOX_SUBPLOT.exec(key);
		if (!match) continue;

		const map = layout[key];
		delete layout[key];
		const newKey = `map${match[1]}`;
		if (newKey in layout || !isObject(map)) continue;

		delete map.accesstoken;
		// Stamen and mapbox:// styles have no map equivalent.
		if (typeof map.style === 'string' && /^(stamen|mapbox:\/\/)/.test(map.style))
			map.style = 'open-street-map';
		layout[newKey] = map;
	}
}

// Plotly attributes that hold colours: *color, colorway, colorscale and pie's marker.colors.
const isColorKey = (key: string) =>
	key.toLowerCase().endsWith('color') ||
	key === 'colors' ||
	key === 'colorway' ||
	key === 'colorscale';

function normalizeColors(props: Json) {
	for (const [key, value] of Object.entries(props)) {
		if (isColorKey(key)) props[key] = normalizeColorValue(value, false);
		else if (isObject(value)) normalizeColors(value);
		else if (Array.isArray(value))
			for (const item of value) if (isObject(item)) normalizeColors(item);
	}
}

// Covers a single colour, a per-point list and colorscale stops ([[0, "ff0000"], ...]).
function normalizeColorValue(value: unknown, inList: boolean): unknown {
	if (Array.isArray(value)) return value.map((v) => normalizeColorValue(v, true));
	if (typeof value !== 'string') return value;
	// Plotly reads numeric strings in a per-point list as numbers for the colorscale.
	if (inList && /^\s*\d+\s*$/.test(value)) return value;
	return normalizePlotlyColor(value);
}

/**
 * Rewrites colour spellings Plotly 3 accepted but Plotly 4 rejects (hex without `#`, `hsv()`)
 * into valid CSS. Anything else is returned unchanged.
 */
export function normalizePlotlyColor(color: string): string {
	const value = color.trim();
	if (BARE_HEX.test(value)) return `#${value}`;

	const hsv = HSV_FUNCTION.exec(value);
	if (!hsv) return color;

	const { r, g, b } = hsvToRgb({
		h: Number(hsv[1]),
		s: unit(hsv[2], hsv[3] === '%'),
		v: unit(hsv[4], hsv[5] === '%')
	});
	const rgb = `${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
	if (hsv[6] === undefined) return `rgb(${rgb})`;
	return `rgba(${rgb},${+unit(hsv[6], hsv[7] === '%').toFixed(3)})`;
}

// Plotly 3 (TinyColor) read 0..1 as a fraction and anything above 1 as a percentage.
function unit(s: string, percent: boolean): number {
	let x = Number(s);
	if (percent || x > 1) x /= 100;
	return Math.min(1, Math.max(0, x));
}
