import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Rhino display data containing the mesh data and material information.
 * //TODO: Change url to use the Compucerapor Plugin
 * See @https://github.com/TheVessen/VektorNodeGhLib/blob/04bca7388d86c1afce8cd4be7cc2d7f73bf74230/Headless/Lib/Utilities/DisplayConverter.cs#L22
 */
export type ThreeDisplay = {
  id?: number;
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  meshData: string;
  name: string;
};

// Pre-compute rotation constants
export const ROTATION_COS = Math.cos(-Math.PI / 2); // 0
export const ROTATION_SIN = Math.sin(-Math.PI / 2); // -1

/**
 * Updates the scene with the given meshes and camera settings.
 * If initialPositionSet is false, it positions the camera and sets the controls target based on the bounding boxes of the meshes.
 * @param scene - The THREE.Scene object to update.
 * @param meshes - An array of THREE.Mesh objects to add to the scene.
 * @param camera - The THREE.PerspectiveCamera object to position.
 * @param controls - The OrbitControls object to update.
 * @param initialPositionSet - A boolean indicating whether the initial position of the camera and controls have been set.
 */
export function updateScene(
  scene: THREE.Scene,
  meshes: THREE.Mesh[],
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  initialPositionSet: boolean,
) {
  clearScene(scene);

  if (meshes.length === 0) return;

  const unionBoundingBox = new THREE.Box3();

  meshes.forEach((mesh) => {
    scene.add(mesh);
    // Create a bounding box for the object
    const boundingBox = new THREE.Box3().setFromObject(mesh);
    // Expand the union bounding box to include the current mesh's bounding box
    unionBoundingBox.union(boundingBox);
  });

  if (!initialPositionSet) {
    // Get the center of the union bounding box
    const center = unionBoundingBox.getCenter(new THREE.Vector3());

    // Get the size of the union bounding box
    const size = unionBoundingBox.getSize(new THREE.Vector3());

    // Calculate a distance that is slightly larger than the largest dimension of the union bounding box
    const distance = Math.max(size.x, size.y, size.z) * 4;

    // If the object is really big, extend the camera's far clipping plane
    if (distance > camera.far) {
      camera.far = distance * 4;
      camera.updateProjectionMatrix();
    }

    // Position the camera a certain distance away from the center of the union bounding box
    camera.position.set(center.x + distance * 0.8, center.y + distance, center.z + distance * 1.2);

    // Set the controls target to the center of the union bounding box
    controls.target = center;

    // Update the controls
    controls.update();
  }
}

/**
 * Converts an array of vertices and indices into a THREE.Mesh object.
 *
 * @param vertices - The array of vertices.
 * @param indices - The array of indices.
 * @returns The THREE.Mesh object representing the vertices and indices.
 */
export function VerticesToThreeMesh(
  vertices: number[] | Float32Array,
  indices: number[] | Uint32Array,
): THREE.Mesh {
  const floatVertices = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
  const floatFaceIndices = indices instanceof Uint32Array ? indices : new Uint32Array(indices);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(floatVertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(floatFaceIndices, 1));
  geometry.computeVertexNormals();

  // Don't create material here - let applyMaterial handle it
  const mesh = new THREE.Mesh(geometry);
  return mesh;
}

// =========================
// Helper functions
// =========================

/**
 * Parses a color string in format "R, G, B" to a THREE.Color object.
 * @param colorString - The color string to parse.
 * @returns A THREE.Color object.
 */
export function parseColor(colorString: string): THREE.Color {
  const rgb = colorString.split(',').map((c) => parseInt(c.trim(), 10));
  if (rgb.length === 3 && rgb.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
    return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
  }
  console.warn(`Invalid color string: ${colorString}, using white`);
  return new THREE.Color(0xffffff);
}

export function applyOffset(meshes: THREE.Mesh[], offsetY: number): void {
  meshes.forEach((mesh) => {
    mesh.position.y -= offsetY;
  });
}

export function computeCombinedBoundingBox(meshes: THREE.Mesh[]): THREE.Box3 {
  const combinedBoundingBox = new THREE.Box3();
  meshes.forEach((mesh) => {
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) {
      combinedBoundingBox.union(mesh.geometry.boundingBox);
    }
  });
  return combinedBoundingBox;
}

/**
 * Clears the given THREE.Scene by removing all meshes and disposing of associated resources.
 * @param scene - The THREE.Scene to clear.
 */
function clearScene(scene: THREE.Scene): void {
  const objectsToRemove: THREE.Object3D[] = [];

  // Collect all meshes except the floor
  scene.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh && child.userData.id !== 'floor') {
      objectsToRemove.push(child);
    }
  });

  // Remove and dispose of each object
  objectsToRemove.forEach((object: THREE.Object3D) => {
    if (object instanceof THREE.Mesh) {
      // Dispose of geometry
      object.geometry?.dispose();

      // Dispose materials and their textures
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        // Dispose textures if they exist
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) {
            value.dispose();
          }
        });
        material.dispose();
      });
    }

    // Remove from parent (cleaner than checking parent existence)
    object.removeFromParent();
  });
}
