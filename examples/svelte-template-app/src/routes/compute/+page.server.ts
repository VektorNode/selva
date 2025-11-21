import { PUBLIC_GH_SCRIPT_URL } from "$env/static/public";
import { createGrasshopperClient } from "$lib/client";
import { error as kitError } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load = (async () => {
  let client;

  try {
    // const ghUrl = `${url.origin}/scripts/${params.slug}.gh`;
    const ghUrl = PUBLIC_GH_SCRIPT_URL;
    client = await createGrasshopperClient();


    const ghInOutputs = await client.getIO(ghUrl);

    if (!ghInOutputs) {
      throw new Error("No outputs received from the compute server.");
    }

    return {
      ghInOutputs,
    };
  } catch (error) {
    if (error && typeof error === "object" && "status" in error) {
      throw error;
    }

    // Handle warmup timeout or other errors
    let errorMessage = "An unexpected error occurred while loading the page.";
    if (error instanceof Error) {
      if (
        error.message.includes("warmup") ||
        error.message.includes("offline")
      ) {
        errorMessage = `Server warmup failed: ${error.message}. Please try again in a few moments.`;
      } else {
        errorMessage = error.message;
      }
    }

    console.error("Server load error:", error);
    throw kitError(503, errorMessage);
  } finally {
    // Now you can access client here
    if (client) {
      client.dispose();
    }
  }
}) satisfies PageServerLoad;

