import type { RhinoModule } from 'rhino3dm';

/**
 * Decoder function signature for a single Rhino type.
 */
type RhinoDecoder = (rhino: RhinoModule, data: unknown) => unknown;

/**
 * Registry of decoders keyed by Rhino type name.
 * Use `registerDecoder()` to add or override decoders.
 */
const decoderRegistry = new Map<string, RhinoDecoder>();

////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////

/**
 * Register a decoder for a Rhino type name.
 */
export function registerDecoder(typeName: string, decoder: RhinoDecoder): void {
  decoderRegistry.set(typeName, decoder);
}

registerDecoder('Rhino.Geometry.Point3d', (rhino, data) => {
  const d = data as any;
  return new rhino.Point([d.X, d.Y, d.Z]);
});

registerDecoder('Rhino.Geometry.Line', (rhino, data) => {
  const d = data as any;
  return new rhino.Line([d.From.X, d.From.Y, d.From.Z], [d.To.X, d.To.Y, d.To.Z]);
});

//TODO: Figure out a way to parse Boxes/Vector3d/Plane...

////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////

/**
 * Options for decoding Rhino geometry
 */
export interface DecodeRhinoOptions {
  /** Only decode specific keys (if not provided, decodes all) */
  keys?: string[];
  /** Skip decoding for specific keys */
  skipKeys?: string[];
}

/**
 * Decodes Rhino geometry objects using registered decoders or CommonObject fallback
 *
 * @param parsedData - The encoded geometry data
 * @param rhinoType - The Rhino type name (e.g., 'Rhino.Geometry.Point3d')
 * @param rhino - The rhino3dm module instance
 * @returns The decoded geometry object or original data on failure
 * @throws Logs warnings on decode failures but does not throw
 */
export function decodeRhinoGeometry(
  parsedData: unknown,
  rhinoType: string,
  rhino: RhinoModule,
): unknown {
  const decoder = decoderRegistry.get(rhinoType);
  if (decoder) {
    try {
      return decoder(rhino, parsedData);
    } catch (error) {
      console.warn(`Failed to decode Rhino type ${rhinoType}:`, error);
    }
  }

  // Fall back to CommonObject.decode for unmapped geometry types
  try {
    if (typeof parsedData === 'object' && parsedData !== null && 'data' in parsedData) {
      return rhino.CommonObject.decode(parsedData);
    }
  } catch (error) {
    console.warn(`Failed to decode ${rhinoType} with CommonObject:`, error);
  }

  return parsedData;
}

/**
 * Decode all enumerable properties of an object that have Rhino type metadata.
 *
 * @param obj - Object to decode
 * @param rhino - The rhino3dm module instance
 * @param options - Decoding options
 * @returns Shallow clone of the object with decoded properties
 */
export function decodeRhinoObject<T extends Record<string, unknown>>(
  obj: T,
  rhino: RhinoModule,
  options: DecodeRhinoOptions = {},
): T {
  const { keys, skipKeys } = options;
  const out: Record<string, unknown> = { ...obj };

  const shouldProcessKey = (k: string) => {
    if (skipKeys?.includes(k)) return false;
    if (keys && !keys.includes(k)) return false;
    return true;
  };

  for (const [key, value] of Object.entries(obj)) {
    if (!shouldProcessKey(key)) continue;

    const maybeType =
      value && typeof value === 'object' && 'type' in (value as any)
        ? (value as any).type
        : undefined;

    if (typeof maybeType === 'string') {
      out[key] = decodeRhinoGeometry(value, maybeType, rhino);
    }
  }

  return out as T;
}
