import { json, type RequestHandler } from "@sveltejs/kit";
import { type DataTree } from "rhino-compute-core/grasshopper";
import { RhinoComputeError } from "rhino-compute-core/core";
import { PUBLIC_GH_SCRIPT_URL } from "$env/static/public";
import { createGrasshopperClient } from "$lib/client";

export const POST: RequestHandler = async ({
  request,
  url,
}): Promise<Response> => {
  try {
    const { tree } = (await request.json()) as {
      tree: DataTree[];
      pointerName: string;
    };
    const ghUrl = PUBLIC_GH_SCRIPT_URL;

    const client = await createGrasshopperClient();
    const result = await client.solve(ghUrl, tree);

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
    let message = "An unexpected error occurred during the compute operation.";
    let status = 500;
    if (error instanceof Error) {
      message = error.message;
      if ("statusCode" in error && typeof error.statusCode === "number") {
        status = error.statusCode;
      }
    }

    return json({ error: { message } }, { status });
  }
};
