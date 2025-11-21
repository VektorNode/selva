import { COMPUTE_URL } from '$lib';
import RhinoCompute from 'compute-rhino3d';
import type { RhinoModule } from 'rhino3dm';

let rhinoInstance: RhinoModule | null = null;
let initializationPromise: Promise<RhinoModule> | null = null;

export async function initializeRhino(
  serverUrl = COMPUTE_URL,
  apiKey?: string,
): Promise<RhinoModule> {
  // If already initialized, return the instance
  if (rhinoInstance) return rhinoInstance;

  // If initialization is in progress, wait for it
  if (initializationPromise) return initializationPromise;

  // Start new initialization
  initializationPromise = (async () => {
    try {
      RhinoCompute.url = serverUrl;
      if (apiKey) {
        RhinoCompute.apiKey = apiKey;
      }

      // @ts-expect-error -- cant find types for rhino3dm
      const rhino3dm = await import('https://unpkg.com/rhino3dm@8.17.0/rhino3dm.module.min.js');
      const module: RhinoModule = await rhino3dm.default();

      if (!module) {
        throw new Error('Failed to load rhino3dm module');
      }

      rhinoInstance = module;
      return module; // Return module directly, not rhinoInstance
    } catch (error) {
      initializationPromise = null; // Reset so it can be retried
      throw error;
    }
  })();

  return initializationPromise;
}

export function getRhino(): RhinoModule | null {
  return rhinoInstance;
}

export function isRhinoReady(): boolean {
  return rhinoInstance !== null;
}

export { RhinoCompute };
