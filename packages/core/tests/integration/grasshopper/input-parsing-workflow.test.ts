import { describe, expect, it } from 'vitest';
// import { mockGrasshopperIoResponse, rawMockNumberInput } from '@tests/fixtures';
import { camelcaseKeys } from '@/core/utils/camel-case';
import processNumericInput from '@/features/grasshopper/io/input/input-parsers/numeric-parser';
import processTextInput from '@/features/grasshopper/io/input/input-parsers/text-parser';
import processBooleanInput from '@/features/grasshopper/io/input/input-parsers/boolean-parser';
import type { InputParamSchema } from '@/features/grasshopper/types';


describe('mixed parameter workflow', () => {
  it('should handle typical parametric design inputs', () => {
    // Simulates a real parametric box definition from Grasshopper
    const inputs: InputParamSchema[] = [
      {
        name: 'Width',
        nickname: 'W',
        description: 'Box width in meters',
        paramType: 'Number',
        default: '10.0',
        minimum: 0.1,
        maximum: 100,
        atLeast: 1,
        atMost: 1,
        treeAccess: false,
        groupName: 'Dimensions',
      } as InputParamSchema,
      {
        name: 'Divisions',
        nickname: 'N',
        description: 'Panel divisions',
        paramType: 'Integer',
        default: '12',
        minimum: 1,
        maximum: 50,
        atLeast: 1,
        atMost: 1,
        treeAccess: false,
        groupName: 'Settings',
      } as InputParamSchema,
      {
        name: 'CreateRoof',
        nickname: 'R',
        description: 'Add roof geometry',
        paramType: 'Boolean',
        default: 'true',
        atLeast: 1,
        atMost: 1,
        treeAccess: false,
        groupName: 'Options',
      } as InputParamSchema,
      {
        name: 'MaterialName',
        nickname: 'M',
        description: 'Material identifier',
        paramType: 'Text',
        default: '"Concrete_C30"',
        atLeast: 1,
        atMost: 1,
        treeAccess: false,
        groupName: 'Materials',
      } as InputParamSchema,
    ];

    // Process all inputs
    processNumericInput(inputs[0]);
    processNumericInput(inputs[1]);
    processBooleanInput(inputs[2]);
    processTextInput(inputs[3]);

    // Verify real-world processing results
    expect(inputs[0].default).toBe(10.0);
    expect(inputs[0].stepSize).toBe(1); // Whole number precision
    expect(inputs[1].default).toBe(12);
    expect(inputs[1].stepSize).toBe(1); // Integer step
    expect(inputs[2].default).toBe(true);
    expect(inputs[3].default).toBe('Concrete_C30');
  });

  it('should process coordinate point lists (common in GH)', () => {
    const inputs: InputParamSchema[] = [
      {
        name: 'X',
        paramType: 'Number',
        default: ['0.0', '5.5', '11.0', '16.5'],
        treeAccess: false,
      } as InputParamSchema,
      {
        name: 'Y',
        paramType: 'Number',
        default: ['0.0', '3.2', '6.4', '9.6'],
        treeAccess: false,
      } as InputParamSchema,
      {
        name: 'Visibility',
        paramType: 'Boolean',
        default: ['true', 'true', 'false', 'true'],
        treeAccess: false,
      } as InputParamSchema,
    ];

    inputs.forEach((input) => {
      switch (input.paramType) {
        case 'Number':
        case 'Integer':
          processNumericInput(input);
          break;
        case 'Boolean':
          processBooleanInput(input);
          break;
      }
    });

    // Verify data matching (all lists same length - critical for GH)
    expect(inputs[0].default).toEqual([0, 5.5, 11, 16.5]);
    expect(inputs[1].default).toEqual([0, 3.2, 6.4, 9.6]);
    expect(inputs[2].default).toEqual([true, true, false, true]);

    // All must have same length for Grasshopper data matching
    const lengths = inputs.map((i) => (Array.isArray(i.default) ? i.default.length : 1));
    expect(new Set(lengths).size).toBe(1);
  });
});

describe('error handling in production scenarios', () => {
  it('should gracefully handle partial data corruption', () => {
    const input: InputParamSchema = {
      name: 'MixedData',
      paramType: 'Number',
      // Simulates corrupted data from network/cache
      default: ['1.0', 'corrupted', '3.5', null, '5.0'] as any[],
      treeAccess: false,
    } as InputParamSchema;

    processNumericInput(input);

    // Should extract valid values and discard invalid
    expect(input.default).toEqual([1, 3.5, 5]);
  });

  it('should handle empty defaults from API', () => {
    const input: InputParamSchema = {
      name: 'OptionalValue',
      paramType: 'Number',
      default: undefined,
      treeAccess: false,
    } as InputParamSchema;

    processNumericInput(input);
    expect(input.default).toBeUndefined();
  });
});
