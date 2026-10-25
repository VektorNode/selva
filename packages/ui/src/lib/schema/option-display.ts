import type { DropdownWidgetConfig, OptionMedia, UISchema } from '@selvajs/schemas';

export type OptionDisplay = NonNullable<DropdownWidgetConfig['displayAs']>;

// Past this a button row no longer fits a panel column. A computed list can grow past it at
// runtime, so the row turns back into a dropdown instead of wrapping.
const MAX_SEGMENTED_OPTIONS = 6;

export function resolveOptionDisplay(
	displayAs: string | undefined,
	optionCount: number
): OptionDisplay {
	switch (displayAs) {
		case 'checklist':
		case 'tiles':
			return displayAs;
		case 'segmented':
			return optionCount <= MAX_SEGMENTED_OPTIONS ? 'segmented' : 'dropdown';
		default:
			return 'dropdown';
	}
}

export type GlyphSource = { kind: 'icon'; d: string } | { kind: 'image'; src: string };

// The schema can come from any .gh, so an image reaches <img> only as an inline raster data URI.
// Anything else could be a URL that makes every viewer's browser call wherever the file points.
const RASTER_DATA_URI = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;

/** What to draw beside an option. `want: 'image'` takes a thumbnail first, then the icon. */
export function optionGlyph(
	media: OptionMedia | undefined,
	assets: UISchema['assets'] | undefined,
	want: 'icon' | 'image'
): GlyphSource | undefined {
	if (!media || !assets) return undefined;

	if (want === 'image' && media.image) {
		const src = assets[media.image]?.img;
		if (src && RASTER_DATA_URI.test(src)) return { kind: 'image', src };
	}

	const d = media.icon ? assets[media.icon]?.d : undefined;
	return d ? { kind: 'icon', d } : undefined;
}
