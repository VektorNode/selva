import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  type NumericInputType,
  type TextInputType,
  type BooleanInputType,
  type InputParam,
  TreeBuilder,
  GrasshopperClient,
} from '@selva/core';
import type { SchemaInput } from '$lib/types/generated';
import { PUBLIC_COMPUTE_SERVER_URL, PUBLIC_GH_DEFINITION } from '$env/static/public';

interface ComputeRequest {
  inputs: (SchemaInput & { minimum?: number; maximum?: number; stepSize?: number })[];
  values: Record<string, unknown>;
  definitionUrl: string;
  serverUrl?: string;
}

/**
 * Transform input parameter to Rhino Compute format
 */
function transformInputParameter(
  input: SchemaInput & { minimum?: number; maximum?: number; stepSize?: number },
  value: unknown
): InputParam {
  const base = {
    description: input.description || '',
    name: input.nickname,
    nickname: input.nickname || null,
    id: input.id,
  };

  if (input.paramType === 'number' || input.paramType === 'integer') {
    return {
      ...base,
      paramType: input.paramType === 'integer' ? 'Integer' : 'Number',
      minimum: input.minimum,
      maximum: input.maximum,
      stepSize: input.paramType === 'integer' ? 1 : input.stepSize,
      default: value ?? input.default,
    } as NumericInputType;
  } else if (input.paramType === 'text') {
    return {
      ...base,
      paramType: 'Text',
      default: (value as string) ?? input.default ?? '',
    } as TextInputType;
  } else if (input.paramType === 'boolean') {
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

    const { inputs, values } = body;

    if (!inputs || !values) {
      throw error(400, 'Missing required fields: inputs, values, or definitionUrl');
    }

    const inputTree = TreeBuilder.fromInputParams(
      inputs
        .filter((input) => input.paramType)
        .map((input) => transformInputParameter(input, values[input.id]))
    );

    const client = await GrasshopperClient.create({ serverUrl: PUBLIC_COMPUTE_SERVER_URL });
    const solvedDefinition = await client.solve(PUBLIC_GH_DEFINITION, inputTree);

    return json(solvedDefinition);
  } catch (err) {
    console.error('[API/Compute] Error:', err);

    if (err instanceof Error) {
      throw error(500, err.message);
    }

    throw error(500, 'Failed to solve Grasshopper definition');
  }
};
