import { PUBLIC_API_KEY, PUBLIC_SERVER_URL } from "$env/static/public";
import {
  GrasshopperClient,
  type GrasshopperComputeConfig,
} from "@computebuilder/core";

export const createGrasshopperClient = () => {
  const config: GrasshopperComputeConfig = {
    serverUrl: PUBLIC_SERVER_URL,
    apiKey: PUBLIC_API_KEY,
    debug: false,
  };
  return new GrasshopperClient(config);
};
