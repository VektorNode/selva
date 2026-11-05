const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/** Decimal units (1 kB = 1000 bytes), as file managers and upload limits usually count. */
export function formatFileSize(bytes: number, locale?: string): string {
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < UNITS.length - 1) {
		value /= 1000;
		unit++;
	}
	return new Intl.NumberFormat(locale, {
		style: 'unit',
		unit: UNITS[unit],
		unitDisplay: unit === 0 ? 'long' : 'short',
		maximumFractionDigits: unit === 0 ? 0 : 1
	}).format(value);
}
