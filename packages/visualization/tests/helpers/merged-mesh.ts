import * as THREE from 'three';

/**
 * `count` unit boxes 10 apart in one indexed geometry, with `userData.members` windows laid out
 * the way `finalizeMergedMesh` writes them: 36 indices per member, ascending and contiguous.
 */
export function mergedBoxes(count = 3): THREE.Mesh {
	const positions: number[] = [];
	const indices: number[] = [];
	const members = [];
	for (let m = 0; m < count; m++) {
		const box = new THREE.BoxGeometry(1, 1, 1).translate(m * 10, 0, 0);
		const offset = positions.length / 3;
		positions.push(...(box.getAttribute('position').array as Float32Array));
		members.push({
			trackingKey: `key-${m}`,
			name: `box-${m}`,
			layer: 'Boxes',
			metadata: {},
			indexStart: indices.length,
			indexCount: box.index!.count
		});
		for (const i of box.index!.array) indices.push(i + offset);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
	const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
	mesh.userData = { members, layer: 'Boxes' };
	return mesh;
}
