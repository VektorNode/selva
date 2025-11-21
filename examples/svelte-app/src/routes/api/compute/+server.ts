import { json, type RequestHandler } from '@sveltejs/kit';
import { solveGrasshopperDefinition, type DataTree } from 'rhino-compute-core/grasshopper';
import { RhinoComputeError } from 'rhino-compute-core/core';
import { COMPUTE_URL } from '$lib';

export const POST: RequestHandler = async ({ request, url }): Promise<Response> => {
  try {
    const { tree, pointerName } = (await request.json()) as {
      tree: DataTree[];
      pointerName: string;
    };
    const ghUrl = `${url.origin}/scripts/${pointerName}.gh`;
    const result = await solveGrasshopperDefinition(tree, ghUrl, {
      serverUrl: COMPUTE_URL,
      debug: false,
    });

    return json(result);
  } catch (error: unknown) {
    // Return structured error response instead of throwing
    if (error instanceof RhinoComputeError) {
      return json(
        {
          error: {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode,
            context: error.context,
          },
        },
        { status: error.statusCode ?? 500 },
      );
    }

    // Fallback for unknown errors
    let message = 'An unexpected error occurred during the compute operation.';
    let status = 500;
    if (error instanceof Error) {
      message = error.message;
      if ('statusCode' in error && typeof error.statusCode === 'number') {
        status = error.statusCode;
      }
    }

    return json({ error: { message } }, { status });
  }
};
