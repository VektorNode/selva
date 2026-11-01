export const STRING_ITEM_TYPE = 'System.String';
export const BOOLEAN_ITEM_TYPE = 'System.Boolean';

/** Every numeric CLR type Grasshopper serializes, so no numeric item stays a string. */
export const NUMERIC_ITEM_TYPES: ReadonlySet<string> = new Set([
	'System.Double',
	'System.Single',
	'System.Decimal',
	'System.Int32',
	'System.Int64'
]);

/** Integral wire item types: rounded like the scalar Integer path. */
export const INTEGER_ITEM_TYPES: ReadonlySet<string> = new Set(['System.Int32', 'System.Int64']);
