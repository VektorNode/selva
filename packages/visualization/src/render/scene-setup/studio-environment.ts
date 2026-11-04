import * as THREE from 'three';

/** What a softbox costs to set up, in radiance: only their ratio to the room matters to a reflection. */
const OVERHEAD = 8;
const KEY_STRIP = 11;
const FILL_STRIP = 4.5;
const RIM = 3.5;
const WALLS = 0.14;
const FLOOR = 0.05;

const ROOM_SIZE = 10;

function softbox(
	radiance: number,
	width: number,
	height: number,
	position: [number, number, number]
): THREE.Mesh {
	const panel = new THREE.Mesh(
		new THREE.PlaneGeometry(width, height),
		new THREE.MeshBasicMaterial({
			color: new THREE.Color().setScalar(radiance),
			side: THREE.DoubleSide
		})
	);
	panel.position.set(...position);
	panel.lookAt(0, 0, 0);
	return panel;
}

/**
 * A photographer's table, for PMREM to bake into a reflection probe: softboxes on a dark room.
 * Shape comes from the gaps between lights. A surface that reflects light everywhere has no contour,
 * which is why three's `RoomEnvironment`, bright on all sides, leaves metal looking like flat paint.
 * The floor stays dark so an underside reads as turned away from the light.
 */
export function createStudioScene(): THREE.Scene {
	const scene = new THREE.Scene();

	const half = ROOM_SIZE / 2;
	const room = new THREE.Mesh(
		new THREE.BoxGeometry(ROOM_SIZE, ROOM_SIZE, ROOM_SIZE),
		new THREE.MeshBasicMaterial({
			color: new THREE.Color().setScalar(WALLS),
			side: THREE.BackSide
		})
	);
	const floor = new THREE.Mesh(
		new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
		new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(FLOOR) })
	);
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = 1 - half;

	scene.add(
		room,
		floor,
		softbox(OVERHEAD, 6.5, 4.5, [0, half - 0.2, 0.6]),
		softbox(KEY_STRIP, 1.4, 5.5, [-(half - 0.3), 0.8, 1.6]),
		softbox(FILL_STRIP, 0.9, 5, [half - 0.3, 0.5, 2.4]),
		softbox(RIM, 5, 0.8, [0.6, 2.2, -(half - 0.3)])
	);
	return scene;
}

/** Frees what {@link createStudioScene} built, once PMREM has baked it. */
export function disposeStudioScene(scene: THREE.Scene): void {
	scene.traverse((object) => {
		const mesh = object as Partial<THREE.Mesh>;
		mesh.geometry?.dispose();
		(mesh.material as THREE.Material | undefined)?.dispose();
	});
}
