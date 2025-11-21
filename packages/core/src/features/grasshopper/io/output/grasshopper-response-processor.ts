import { downloadFileData, FileBaseInfo } from '@/features/file-handling';
import { FileData } from '@/features/file-handling/types';
import { getThreeMeshesFromComputeResponse } from '@/features/visualization';

import { GrasshopperComputeResponse } from '../../types';

import {
  extractFileData,
  getParameterNames,
  getValues,
  GetValuesOptions,
  GetValuesResult,
  ParsedContext,
} from './response-processors';

/**
 * Processes and provides convenient access to Grasshopper Compute API responses.
 *
 * @public This is the recommended way to extract data from compute responses.
 *
 * This class wraps a GrasshopperComputeResponse and provides a unified API to extract
 * various types of data including strings, files, parameters, and 3D meshes.
 *
 * @example
 * ```typescript
 * const processor = new GrasshopperResponseProcessor(response);
 *
 * // Get all outputs with TypeScript types
 * const { values, types } = processor.getValues({ generateTypes: true });
 * console.log(types?.interface); // TypeScript interface string
 *
 * // Get string outputs only
 * const { values } = processor.getValues({ stringOnly: true });
 *
 * // Get a specific parameter by name
 * const items = processor.getParameter('geometry');
 *
 * // Download all files
 * processor.getAndDownloadFiles('output');
 * ```
 */
export default class GrasshopperResponseProcessor {
  private response: GrasshopperComputeResponse;

  /**
   * Creates a new GrasshopperResponseProcessor instance.
   *
   * @param response - The Grasshopper Compute API response to process
   */
  constructor(response: GrasshopperComputeResponse) {
    this.response = response;
  }

  /**
   * Extract and parse values from compute responses with flexible configuration.
   *
   * This method supports three main features:
   * - **Automatic geometry decoding**: Convert Rhino objects to rhino3dm class instances
   * - **Type generation**: Infer TypeScript type definitions from response data
   * - **Flexible filtering**: Extract specific output types or string-only results
   *
   * @typeParam T - The expected output type for full type safety
   * @param options - Configuration options
   * @param options.rhino - Rhino module instance for geometry decoding
   * @param options.generateTypes - Generate TypeScript type definitions
   * @param options.stringOnly - Extract only string outputs
   * @param options.types - Filter by specific .NET type names
   * @param options.parseValues - Parse values to native types (default: true)
   * @param options.toCamelCase - Convert property names to camelCase (default: true)
   * @returns Object containing parsed values and optional type definitions
   *
   * @example
   * // Basic usage: extract all values
   * const { values } = processor.getValues();
   * console.log(values.count); // number
   *
   * @example
   * // Extract string outputs only
   * const { values } = processor.getValues({ stringOnly: true });
   *
   * @example
   * // Filter by specific .NET types
   * const { values } = processor.getValues({
   *   types: ['System.String', 'System.Int32', 'System.Double']
   * });
   *
   * @example
   * // Decode Rhino geometry objects
   * import rhino3dm from 'rhino3dm';
   *
   * const rhino = await rhino3dm();
   * const { values } = processor.getValues({ rhino });
   *
   * console.log(values.points[0].x); // Point.x property
   * console.log(values.mesh.vertices()); // Mesh.vertices() method
   *
   * @example
   * // Generate TypeScript types
   * const { values, types } = processor.getValues({ generateTypes: true });
   *
   * // Copy types?.interface into your code for type safety:
   * // export interface GrasshopperOutput {
   * //   count: number;
   * //   points: Point[];
   * //   mesh: Mesh;
   * // }
   *
   * @example
   * // Full type-safe workflow
   * import rhino3dm from 'rhino3dm';
   *
   * const rhino = await rhino3dm();
   * const { values, types } = processor.getValues({
   *   rhino,
   *   generateTypes: true
   * });
   *
   * // Define your output type based on generated types
   * type MyOutput = {
   *   centerPoint: Point;
   *   geometry: Mesh;
   *   volume: number;
   * };
   *
   * // Use generic parameter for full type safety
   * const typedValues = processor.getValues<MyOutput>({ rhino });
   * typedValues.values.centerPoint.x; // ✅ TypeScript knows Point.x exists
   *
   * @example
   * // Customize parsing behavior
   * const { values } = processor.getValues({
   *   parseValues: false,  // Keep "123" as string
   *   toCamelCase: false   // Keep "Output Parameter" format
   * });
   */
  public getValues<T = ParsedContext>(options: GetValuesOptions = {}): GetValuesResult<T> {
    return getValues<T>(this.response, options);
  }

  /**
   * Returns all parameter names present in the response.
   *
   * Useful for discovering what outputs are available without
   * needing to know the parameter names in advance.
   *
   * @returns An array of parameter name strings
   *
   * @example
   * ```typescript
   * const names = processor.getParameterNames();
   * console.log('Available parameters:', names.join(', '));
   * ```
   */
  public getParameterNames(): string[] {
    return getParameterNames(this.response);
  }

  /**
   * Extracts and converts geometry data to Three.js mesh objects.
   *
   * Processes the response to extract 3D geometry and returns it as
   * Three.js meshes ready for rendering in a 3D scene.
   *
   * @returns Promise resolving to Three.js mesh objects representing the geometry in the response
   *
   * @example
   * ```typescript
   * const meshes = await processor.extractMeshesFromResponse();
   * scene.add(...meshes);
   * ```
   */
  public async extractMeshesFromResponse() {
    return await getThreeMeshesFromComputeResponse(this.response);
  }

  /**
   * Extracts all file data from the response.
   *
   * Returns file information for any files generated by the Grasshopper
   * computation, such as exported geometry or generated documents.
   *
   * @returns An array of FileData objects containing file information
   *
   */
  private getFileData(): FileData[] {
    return extractFileData(this.response);
  }

  /**
   * Downloads all files from the response to the user's device.
   *
   * Extracts file data from the response and triggers browser downloads,
   * optionally including additional files not in the response.
   *
   * @param folderName - The name to use for organizing downloaded files
   * @param additionalFiles - Optional additional files to include in the download.
   *                          Can be a single FileBaseInfo object, an array, or null
   *
   * @example
   * ```typescript
   * // Download response files only
   * processor.getAndDownloadFiles('my-grasshopper-output');
   *
   * // Include additional files
   * const extraFile = { name: 'readme.txt', data: '...' };
   * processor.getAndDownloadFiles('output', extraFile);
   * ```
   */
  public getAndDownloadFiles(
    folderName: string,
    additionalFiles?: FileBaseInfo[] | FileBaseInfo | null
  ) {
    const files = this.getFileData();
    downloadFileData(files, folderName, additionalFiles);
  }
}
