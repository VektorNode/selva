// The widget a param type gets, pinned in one fixture that the plugin's
// WidgetMappingParityTests reads too: a param placed from the canvas or a script must get the
// widget a drag in the editor gives it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ParamType } from '@selvajs/schemas';
import { mapParamTypeToWidgetType } from '../widget-config';

const fixture = JSON.parse(
	readFileSync(
		new URL('../../../../../../schemas/fixtures/widget-mapping.json', import.meta.url),
		'utf-8'
	)
) as { inputs: Record<string, string>; outputs: Record<string, string> };

describe('widget mapping parity with the plugin', () => {
	it.each(Object.entries(fixture.inputs))('input %s → %s', (type, widget) => {
		expect(mapParamTypeToWidgetType(type as ParamType, 'input')).toBe(widget);
	});

	it.each(Object.entries(fixture.outputs))('output %s → %s', (type, widget) => {
		expect(mapParamTypeToWidgetType(type as ParamType, 'output')).toBe(widget);
	});
});
