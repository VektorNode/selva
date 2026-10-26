import type { OptionAsset, UISchema } from '@selvajs/schemas';

// Icons for value-list options are saved inside the .gh, so an icon is flattened to one path
// string and identical content is stored once under a hash of itself. No runtime imports, so the
// dev mock can run this file directly under Node.

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
 * assets in one schema apart, and it needs no secure context, which `crypto.subtle` does. A
 * nonzero `salt` gives content another id when its own is held by different content.
 */
export function assetId(asset: OptionAsset, salt = 0): string {
	const content = asset.d ?? asset.img ?? '';
	let hash = FNV_OFFSET;
	for (const byte of new TextEncoder().encode(salt ? `${content}#${salt}` : content)) {
		hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
	}
	return hash.toString(16).padStart(16, '0').slice(0, 12);
}

/** Adds an asset to the schema unless the same content is already there; returns its id. */
export function putAsset(schema: UISchema, asset: OptionAsset): string {
	schema.assets ??= {};
	// Searched by content, not along the salt chain: pruning the content that held salt 0 leaves
	// a gap in front of what went in under salt 1.
	for (const [id, existing] of Object.entries(schema.assets)) {
		if (existing.d === asset.d && existing.img === asset.img) return id;
	}
	for (let salt = 0; ; salt++) {
		const id = assetId(asset, salt);
		if (!schema.assets[id]) {
			schema.assets[id] = asset;
			return id;
		}
	}
}

/** Lucide's export name as the kebab-case name its site and the picker use. */
export function lucideName(exportName: string): string {
	return exportName
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.replace(/([a-zA-Z]{2})(\d)/g, '$1-$2')
		.toLowerCase();
}

/**
 * Every icon once, by name. Lucide also exports aliases (`ArrowDownAZ` beside `ArrowDownAz`)
 * that name the same icon, and a picker listing both repeats it.
 */
export function listIcons(all: Record<string, unknown>): { name: string; node: IconNode }[] {
	const byName = new Map<string, IconNode>();
	for (const [exportName, node] of Object.entries(all)) {
		const name = lucideName(exportName);
		if (!byName.has(name)) byName.set(name, node as IconNode);
	}
	return [...byName].map(([name, node]) => ({ name, node }));
}
