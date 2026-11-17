import { SCALE_FACTORS } from '@selvajs/visualization/parse';

const SUFFIXES: Record<string, string> = {
	Microns: 'µm',
	Millimeters: 'mm',
	Centimeters: 'cm',
	Decimeters: 'dm',
	Meters: 'm',
	Kilometers: 'km',
	Inches: 'in',
	Feet: 'ft',
	Yards: 'yd',
	Miles: 'mi'
};

export interface ModelUnits {
	/** Scene metres per model unit: the factor the display parser scaled the solve's geometry by. */
	metersPerUnit: number;
	/** Empty for a unit with no common abbreviation. */
	suffix: string;
}

/** Null for a unit the display parser doesn't scale: a sketch could not line up with the model. */
export function modelUnits(name: string | null | undefined): ModelUnits | null {
	const metersPerUnit = name ? SCALE_FACTORS[name] : undefined;
	if (metersPerUnit === undefined) return null;
	return { metersPerUnit, suffix: SUFFIXES[name as string] ?? '' };
}
