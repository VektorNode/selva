import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  initialPositionSet: boolean
) {
  clearScene(scene);

  if (meshes.length === 0) return;

  const unionBoundingBox = new THREE.Box3();

  meshes.forEach((mesh) => {
    scene.add(mesh);
    const boundingBox = new THREE.Box3().setFromObject(mesh);
    unionBoundingBox.union(boundingBox);
  });

  if (!initialPositionSet) {
    // Get the center of the union bounding box
    const center = unionBoundingBox.getCenter(new THREE.Vector3());
    const size = unionBoundingBox.getSize(new THREE.Vector3());

    // Calculate a distance that is slightly larger than the largest dimension of the union bounding box
    const distance = Math.max(size.x, size.y, size.z) * 4;

    if (distance > camera.far) {
      camera.far = distance * 4;
      camera.updateProjectionMatrix();
    }

    camera.position.set(center.x + distance * 0.8, center.y + distance, center.z + distance * 1.2);
    controls.target = center;

    controls.update();
  }
}

// =========================
// Helper functions
// =========================

/**
 * Parses a color string in multiple formats to a THREE.Color object.
 * Supported formats:
 * - Hex: "#C7A5A5", "C7A5A5"
 * - RGB: "199, 165, 165"
 * - CSS named colors: "red", "blue", etc.
 * @param colorString - The color string to parse.
 * @returns A THREE.Color object.
 */
export function parseColor(colorString: string): THREE.Color {
  if (!colorString || typeof colorString !== 'string') {
    console.warn(`Invalid color input: ${colorString}, using white`);
    return new THREE.Color(0xffffff);
  }

  const trimmed = colorString.trim();

  // Try hex format (#C7A5A5 or C7A5A5)
  if (trimmed.startsWith('#') || /^[0-9A-Fa-f]{6}$/.test(trimmed)) {
    try {
      const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      return new THREE.Color(hex);
    } catch {
      console.warn(`Invalid hex color: ${colorString}, using white`);
      return new THREE.Color(0xffffff);
    }
  }

  // Try RGB format (R, G, B)
  if (trimmed.includes(',')) {
    const rgb = trimmed.split(',').map((c) => parseInt(c.trim(), 10));
    if (rgb.length === 3 && rgb.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
      return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    }
  }

  // Try CSS named color
  try {
    return new THREE.Color(trimmed.toLowerCase());
  } catch {
    console.warn(`Invalid color string: ${colorString}, using white`);
    return new THREE.Color(0xffffff);
  }
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
      object.geometry?.dispose();

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value instanceof THREE.Texture) {
            value.dispose();
          }
        });
        material.dispose();
      });
    }

    object.removeFromParent();
  });
}
