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
