import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  solveGrasshopperDefinition,
  type NumericInputType,
  type TextInputType,
  type BooleanInputType,
  type InputParam,
  DataTree,
} from '@computebuilder/core';
import type { InputParamSchema } from '$lib/types/generated';

interface ComputeRequest {
  inputs: InputParamSchema[];
  values: Record<string, unknown>;
  definitionUrl: string;
  serverUrl?: string;
}

/**
 * Transform input parameter to Rhino Compute format
 */
function transformInputParameter(input: InputParamSchema, value: unknown): InputParam {
  const base = {
    description: input.description || '',
    name: input.nickname || input.name,
    nickname: input.nickname || null,
    treeAccess: input.treeAccess || false,
    paramId: input.id,
  };

  if (input.paramType === 'Number' || input.paramType === 'Integer') {
    return {
      ...base,
      paramType: input.paramType as 'Number' | 'Integer',
      minimum: input.minimum,
      maximum: input.maximum,
      atLeast: input.atLeast,
      atMost: input.atMost,
      stepSize: input.paramType === 'Integer' ? 1 : input.stepSize,
      default: value ?? input.default,

    } as NumericInputType;
  } else if (input.paramType === 'Text') {
    return {
      ...base,
      paramType: 'Text',
      default: (value as string) ?? input.default ?? '',
    } as TextInputType;
  } else if (input.paramType === 'Boolean') {
    return {
      ...base,
      paramType: 'Boolean',
      default: (value as boolean) ?? input.default ?? false,
    } as BooleanInputType;
  }

  return {
    ...base,
    paramType: 'Text',
    default: (value as string) ?? '',
  } as TextInputType;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body: ComputeRequest = await request.json();

    const { inputs, values, definitionUrl, serverUrl = 'http://localhost:5000/' } = body;

    if (!inputs || !values || !definitionUrl) {
      throw error(400, 'Missing required fields: inputs, values, or definitionUrl');
    }

    // Transform inputs to data trees
    const inputTree = DataTree.fromInputParams(
      inputs
        .filter((input) => input.paramType)
        .map((input) => transformInputParameter(input, values[input.id]))
    );

    // Solve the Grasshopper definition and return raw response
    // Mesh extraction happens on client side (requires Three.js)
    const solvedDefinition = await solveGrasshopperDefinition(inputTree, definitionUrl, {
      serverUrl,
    });

    return json(solvedDefinition);
  } catch (err) {
    console.error('[API/Compute] Error:', err);

    if (err instanceof Error) {
      throw error(500, err.message);
    }

    throw error(500, 'Failed to solve Grasshopper definition');
  }
};
