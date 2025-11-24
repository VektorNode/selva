/**
 * Input grouping and organization types
 */

import type { InputParam } from './parameters';

/**
 * Grouped inputs by category
 */
export interface GroupInputs {
  [key: string]: {
    inputs: InputParam[];
  };
}

/**
 * Node in a nested group tree structure
 */
export interface NestedGroupNode {
  /** Display name of this group level */
  name: string;
  /** Full path to this node (e.g., "Layer_1::Layer_2") */
  path: string;
  /** Inputs that belong directly to this group level */
  inputs: InputParam[];
  /** Child group nodes */
  children: Map<string, NestedGroupNode>;
}

/**
 * Nested grouped inputs organized in a tree structure
 */
export interface NestedGroupInputs {
  [key: string]: NestedGroupNode;
}
