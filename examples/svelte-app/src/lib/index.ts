import { type GrasshopperComputeConfig, GrasshopperClient } from 'rhino-compute-core';
import { PUBLIC_SERVER_URL } from '$env/static/public';

//NEEDs a / at the end since its failing without it at get curve length
export const COMPUTE_URL = PUBLIC_SERVER_URL;
export const DEFAULT_API_KEY = '';
export const DEFAULT_CONFIG = {
  serverUrl: COMPUTE_URL,
  apiKey: DEFAULT_API_KEY,
  absolutetolerance: 0.001,
  modelunits: 'Millimeters',
  cachesolve: true,
  angletolerance: 0.1,
  dataversion: 8,
  debug: false,
} as GrasshopperComputeConfig;

export const definitionUrl =
  'http://localhost:5173/FELIX- Sheetmetal Quick Calculator_0.67__20250919.gh';

export const createGrasshopperClient = () => {
  const config: GrasshopperComputeConfig = {
    serverUrl: COMPUTE_URL,
    apiKey: DEFAULT_API_KEY,
    absolutetolerance: 0.001,
    modelunits: 'Millimeters',
    cachesolve: true,
    angletolerance: 0.1,
    dataversion: 8,
    debug: false,
  };
  return new GrasshopperClient(config);
};
