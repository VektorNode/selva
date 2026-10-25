import type { OptionAsset, UISchema } from '@selvajs/schemas';
import { getAllLayoutItems } from './operations';

// Icons and thumbnails for value-list options. They are saved inside the .gh, so an icon is
// flattened to one path string and identical content is stored once under a hash of itself.

export type IconNode = [tag: string, attrs: Record<string, string | number>][];

const num = (v: string | number | undefined): number => Number(v ?? 0);

const NUMBER = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?`;
const RELATIVE_START = new RegExp(`^\\s*m\\s*(${NUMBER})[\\s,]*(${NUMBER})[\\s,]*(.*)$`, 's');

/**
 * A path's opening `m` is absolute only at the very start of a `d`. Joined after another shape
 * it would be read from where that shape ended, so it becomes `M`, and the pairs after it, which
 * `m` reads as relative line-tos, get their `l`.
 */
function absoluteStart(d: string): string {
	const match = RELATIVE_START.exec(d);
	if (!match) return d;
	const [, x, y, rest] = match;
	const implicitLine = rest !== '' && !/^[a-z]/i.test(rest);
	return `M${x} ${y}${implicitLine ? 'l' : ''}${rest}`;
}

function pointsToPath(points: string, close: boolean): string {
	const coords = points
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	const pairs: string[] = [];
	for (let i = 0; i + 1 < coords.length; i += 2) pairs.push(`${coords[i]} ${coords[i + 1]}`);
	return `M${pairs.join('L')}${close ? 'z' : ''}`;
}

function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
	return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
}

function rectToPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
	if (rx === 0 && ry === 0) return `M${x} ${y}h${w}v${h}h${-w}z`;
	const arc = (dx: number, dy: number) => `a${rx} ${ry} 0 0 1 ${dx} ${dy}`;
	return (
		`M${x + rx} ${y}h${w - 2 * rx}${arc(rx, ry)}v${h - 2 * ry}${arc(-rx, ry)}` +
		`h${-(w - 2 * rx)}${arc(-rx, -ry)}v${-(h - 2 * ry)}${arc(rx, -ry)}z`
	);
}

/**
 * One path for a whole Lucide icon, drawn with Lucide's stroke defaults. The few filled dots
 * Lucide draws come out as stroked circles, a hair larger at icon size.
 */
export function iconNodeToPath(node: IconNode): string {
	return node
		.map(([tag, a]) => {
			switch (tag) {
				case 'path':
					return absoluteStart(String(a.d ?? ''));
				case 'circle':
					return ellipseToPath(num(a.cx), num(a.cy), num(a.r), num(a.r));
				case 'ellipse':
					return ellipseToPath(num(a.cx), num(a.cy), num(a.rx), num(a.ry));
				case 'rect': {
					// SVG takes a missing corner radius from the other one.
					const rx = num(a.rx ?? a.ry);
					const ry = num(a.ry ?? a.rx);
					return rectToPath(num(a.x), num(a.y), num(a.width), num(a.height), rx, ry);
				}
				case 'line':
					return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
				case 'polyline':
				case 'polygon':
					return pointsToPath(String(a.points ?? ''), tag === 'polygon');
				default:
					return '';
			}
		})
		.filter(Boolean)
		.join(' ');
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

/**
 * FNV-1a over the asset's content, 48 bits. Not a security hash: it only has to tell a few dozen
 * assets in one schema apart, and it needs no secure context, which `crypto.subtle` does.
 */
export function assetId(asset: OptionAsset): string {
	let hash = FNV_OFFSET;
	for (const byte of new TextEncoder().encode(asset.d ?? asset.img ?? '')) {
		hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
	}
	return hash.toString(16).padStart(16, '0').slice(0, 12);
}

/** Adds an asset to the schema unless the same content is already there; returns its id. */
export function putAsset(schema: UISchema, asset: OptionAsset): string {
	const id = assetId(asset);
	schema.assets ??= {};
	schema.assets[id] ??= asset;
	return id;
}

/**
 * Drops what no longer reaches the screen: media for options a static list no longer has, and
 * assets nothing points at. A dynamic list's options exist only at runtime, so its media stays.
 */
export function pruneUnusedMedia(schema: UISchema): void {
	const used = new Set<string>();

	for (const item of getAllLayoutItems(schema)) {
		if (item.type !== 'input') continue;
		if (item.widgetType !== 'dropdown' && item.widgetType !== 'dynamicValueList') continue;
		const config = item.config;
		const media = config?.optionMedia;
		if (!media) continue;

		if (item.widgetType === 'dropdown') {
			const options = item.config.options ?? {};
			for (const name of Object.keys(media)) {
				if (!(name in options)) delete media[name];
			}
		}

		for (const entry of Object.values(media)) {
			if (entry?.icon) used.add(entry.icon);
			if (entry?.image) used.add(entry.image);
		}
	}

	if (!schema.assets) return;
	for (const id of Object.keys(schema.assets)) {
		if (!used.has(id)) delete schema.assets[id];
	}
	if (Object.keys(schema.assets).length === 0) delete schema.assets;
}

/** Characters the assets add to the saved schema, which is what the .gh grows by. */
export function assetBytes(assets: UISchema['assets']): number {
	let total = 0;
	for (const asset of Object.values(assets ?? {})) {
		total += (asset?.d ?? asset?.img ?? '').length;
	}
	return total;
}
