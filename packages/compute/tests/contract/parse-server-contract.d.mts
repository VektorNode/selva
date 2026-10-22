/** A single C# class and the wire property names it contributes. */
export interface ParsedClass {
	/** C# class name, e.g. `InputParamSchema`. */
	name: string;
	/** Base class name if the class declares one (`class A : B`), else null. */
	base: string | null;
	/**
	 * Wire property names declared directly on this class (not inherited), in source order. For
	 * `[JsonProperty("x")]` members this is `"x"`; for attribute-less serialized members (DataTree)
	 * it is the C# member name.
	 */
	properties: string[];
}

/** The shape we snapshot and compare: only the pieces the client reads. */
export interface ServerContract {
	/** Git ref the source was taken from, e.g. `Compute8`. */
	ref: string;
	/** Each relevant class keyed by C# name. */
	classes: Record<string, ParsedClass>;
}

export function parseServerContract(
	schemaCs: string,
	ghPathCs: string,
	ref: string
): ServerContract;

/** A class's full wire property set, inherited members first. */
export function flatten(contract: ServerContract, className: string): string[];
