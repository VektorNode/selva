import { describe, it, expect } from 'vitest';
import { groupInputs, groupInputsNested } from './input-grouping';
import type { InputParam } from '../../../../core/src/features/grasshopper/types.js';

describe('groupInputsNested', () => {
  it('should group inputs with nested group names', () => {
    const inputs: InputParam[] = [
      {
        description: '',
        name: 'Get Number1',
        nickname: null,
        treeAccess: false,
        groupName: 'Layer_1',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
      {
        description: '',
        name: 'Get Number2',
        nickname: null,
        treeAccess: false,
        groupName: 'Layer_1::Layer_2',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
      {
        description: '',
        name: 'Get Number3',
        nickname: null,
        treeAccess: false,
        groupName: 'Layer_1::Layer_2::Layer_3',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
    ];

    const result = groupInputsNested(inputs);

    // Should have one root level group
    expect(Object.keys(result)).toHaveLength(1);
    expect(result['Layer_1']).toBeDefined();

    // Layer_1 should have Get Number1 input
    expect(result['Layer_1'].inputs).toHaveLength(1);
    expect(result['Layer_1'].inputs[0].name).toBe('Get Number1');

    // Layer_1 should have one child (Layer_2)
    expect(result['Layer_1'].children.size).toBe(1);
    expect(result['Layer_1'].children.has('Layer_2')).toBe(true);

    const layer2 = result['Layer_1'].children.get('Layer_2')!;

    // Layer_2 should have Get Number2 input
    expect(layer2.inputs).toHaveLength(1);
    expect(layer2.inputs[0].name).toBe('Get Number2');

    // Layer_2 should have one child (Layer_3)
    expect(layer2.children.size).toBe(1);
    expect(layer2.children.has('Layer_3')).toBe(true);

    const layer3 = layer2.children.get('Layer_3')!;

    // Layer_3 should have Get Number3 input
    expect(layer3.inputs).toHaveLength(1);
    expect(layer3.inputs[0].name).toBe('Get Number3');

    // Layer_3 should have no children
    expect(layer3.children.size).toBe(0);
  });

  it('should handle multiple root groups', () => {
    const inputs: InputParam[] = [
      {
        description: '',
        name: 'Input1',
        nickname: null,
        treeAccess: false,
        groupName: 'Group_A',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
      {
        description: '',
        name: 'Input2',
        nickname: null,
        treeAccess: false,
        groupName: 'Group_B',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
    ];

    const result = groupInputsNested(inputs);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result['Group_A']).toBeDefined();
    expect(result['Group_B']).toBeDefined();
    expect(result['Group_A'].inputs[0].name).toBe('Input1');
    expect(result['Group_B'].inputs[0].name).toBe('Input2');
  });

  it('should skip hidden groups', () => {
    const inputs: InputParam[] = [
      {
        description: '',
        name: 'Visible',
        nickname: null,
        treeAccess: false,
        groupName: 'Visible',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
      {
        description: '',
        name: 'Hidden1',
        nickname: null,
        treeAccess: false,
        groupName: 'Hidden',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
      {
        description: '',
        name: 'Hidden2',
        nickname: null,
        treeAccess: false,
        groupName: 'Hide',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-3',
      },
    ];

    const result = groupInputsNested(inputs);

    expect(Object.keys(result)).toHaveLength(1);
    expect(result['Visible']).toBeDefined();
    expect(result['Hidden']).toBeUndefined();
    expect(result['Hide']).toBeUndefined();
  });

  it('should skip hidden groups at any level', () => {
    const inputs: InputParam[] = [
      {
        description: '',
        name: 'Should be skipped',
        nickname: null,
        treeAccess: false,
        groupName: 'Layer_1::Hidden::Layer_3',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-1',
      },
    ];

    const result = groupInputsNested(inputs);

    expect(Object.keys(result)).toHaveLength(0);
  });

  it('should handle custom separator', () => {
    const inputs: InputParam[] = [
      {
        description: '',
        name: 'Input1',
        nickname: null,
        treeAccess: false,
        groupName: 'Group_A/Group_B',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-1',
      },
    ];

    const result = groupInputsNested(inputs, { separator: '/' });

    expect(result['Group_A']).toBeDefined();
    expect(result['Group_A'].children.has('Group_B')).toBe(true);
  });

  it('should preserve full path in node metadata', () => {
    const inputs: InputParam[] = [
      {
        description: '',
        name: 'Input1',
        nickname: null,
        treeAccess: false,
        groupName: 'A::B::C',
        paramType: 'Number',
        minimum: 0,
        maximum: 5,
        atLeast: 1,
        atMost: 1,
        stepSize: 1,
        default: 0,
        id: 'param-1',
      },
    ];

    const result = groupInputsNested(inputs);

    expect(result['A'].path).toBe('A');
    const nodeB = result['A'].children.get('B')!;
    expect(nodeB.path).toBe('A::B');
    const nodeC = nodeB.children.get('C')!;
    expect(nodeC.path).toBe('A::B::C');
  });
});
