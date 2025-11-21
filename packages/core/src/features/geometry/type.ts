// ============================================================================
// BASIC GEOMETRIC TYPES
// TODO: Consider to use rhino3d for this
// ============================================================================

/**
 * @public
 */
export type Point = {
  X: number;
  Y: number;
  Z: number;
};

/**
 * @public
 */
export type Line = {
  From: Point;
  To: Point;
};
