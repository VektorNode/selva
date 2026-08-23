/**
 * The value an input should carry when the schema provides no explicit default.
 * Keyed by the parameter's `paramType`; unknown types fall through to `null` so
 * the caller can decide how to treat an unrecognized param.
 */
export function getDefaultValue(paramType: string): unknown {
	switch (paramType) {
		case 'number':
		case 'integer':
			return 0;
		case 'boolean':
			return false;
		case 'text':
			return '';
		default:
			return null;
	}
}
