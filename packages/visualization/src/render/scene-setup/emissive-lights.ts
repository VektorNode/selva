import * as THREE from 'three';

import {
	EMISSIVE_LIGHT,
	OWN_EMISSIVE,
	getBaseMaterial,
	getHiddenMembers
} from '../../shared/index.js';
import { SOURCE_COMPUTE } from '../scene-ownership.js';
import { memberBounds, membersOf } from './merged-picking.js';

/** Point lights are expensive: every lit material pays for each one in its shader. */
const DEFAULT_MAX_LIGHTS = 3;
/** Six shadow-map faces per light, each drawing the whole scene. */
const MAX_SHADOWED_LIGHTS = 2;
const SHADOW_MAP_SIZE = 1024;
/** A glow this far below the strongest is a lit surface, not a source: a diffuser, not the bulb. */
const MIN_RELATIVE_STRENGTH = 1 / 3;
/** Parts this close, as a share of the larger one's diagonal, are one lamp: a bulb and its reflector. */
const SAME_LAMP_GAP = 0.05;
/**
 * three's point lights are in candela, so brightness falls off with the scene's units squared.
 * Scaling by the scene's radius squared makes one strength read the same in millimetres and metres.
 */
const INTENSITY_PER_STRENGTH = 0.17;
/** Share of a source's light that comes back off the room, with no shadow to stop it. */
const BOUNCE_SHARE = 0.07;
/** A lamp's source has a size, so its shadow has a penumbra; three's default edge is a hard line. */
const SHADOW_SOFTNESS = 7;
/** A source wider than this share of the scene isn't a point. */
const MAX_POINT_SOURCE_SPREAD = 0.15;

/** One object that glows: a whole mesh, or one member of a merged mesh. */
type GlowingPart = {
	mesh: THREE.Mesh;
	material: THREE.MeshStandardMaterial;
	bounds: THREE.Box3;
};

type Lamp = {
	bounds: THREE.Box3;
	meshes: Set<THREE.Mesh>;
};

type Source = Lamp & {
	color: THREE.Color;
	strength: number;
	/** Absolute intensity from real lumens. Without one, scaled to the model. */
	light?: number;
};

// The base, not `mesh.material`: a selection clone copies the emissive flag beside its red tint.
function emissiveMaterialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial | null {
	const material = getBaseMaterial(mesh);
	return material?.userData[OWN_EMISSIVE] ? (material as THREE.MeshStandardMaterial) : null;
}

function drawnBounds(mesh: THREE.Mesh): THREE.Box3[] {
	const members = membersOf(mesh);
	if (!members) return [new THREE.Box3().setFromObject(mesh)];
	const hidden = getHiddenMembers(mesh);
	return members
		.filter((_, index) => !hidden.has(index))
		.map((member) => memberBounds(mesh, member))
		.filter((bounds) => !bounds.isEmpty());
}

function touches(a: THREE.Box3, b: THREE.Box3): boolean {
	const diagonal = (box: THREE.Box3) => box.getSize(new THREE.Vector3()).length();
	const gap = Math.max(diagonal(a), diagonal(b)) * SAME_LAMP_GAP;
	return a.clone().expandByScalar(gap).intersectsBox(b);
}

/**
 * Groups parts of one glow into lamps by contact. More lamps than lights get one light in the
 * middle: lighting three of a street's lamps would pick them by mesh order.
 */
function lampsOf(parts: GlowingPart[], maxLights: number): Lamp[] {
	let lamps: Lamp[] = [];
	for (const part of parts) {
		const lamp: Lamp = { bounds: part.bounds.clone(), meshes: new Set([part.mesh]) };
		const separate: Lamp[] = [];
		for (const other of lamps) {
			if (touches(other.bounds, part.bounds)) {
				lamp.bounds.union(other.bounds);
				for (const mesh of other.meshes) lamp.meshes.add(mesh);
			} else separate.push(other);
		}
		lamps = [...separate, lamp];
		if (lamps.length > maxLights) {
			const bounds = new THREE.Box3();
			for (const each of parts) bounds.union(each.bounds);
			return [{ bounds, meshes: new Set(parts.map((each) => each.mesh)) }];
		}
	}
	return lamps;
}

// By glow, not material instance: the parser splits one material between closed and open meshes.
function sourcesFrom(parts: GlowingPart[], maxLights: number): Source[] {
	const byGlow = new Map<string, GlowingPart[]>();
	for (const part of parts) {
		const { emissive, emissiveIntensity, userData } = part.material;
		const glow = `${emissive.getHexString()}|${emissiveIntensity}|${userData[EMISSIVE_LIGHT]}`;
		const same = byGlow.get(glow);
		if (same) same.push(part);
		else byGlow.set(glow, [part]);
	}
	return [...byGlow.values()].flatMap((same) => {
		const { emissive, emissiveIntensity, userData } = same[0]!.material;
		return lampsOf(same, maxLights).map((lamp) => ({
			...lamp,
			color: emissive,
			strength: emissiveIntensity,
			light: userData[EMISSIVE_LIGHT]
		}));
	});
}

/**
 * Picks the strongest emissive materials to light the scene. Exported for tests: which surface
 * counts as a source decides whether a lamp's desk gets one pool of light or a washed-out pair.
 */
export function pickLightSources<S extends { strength: number }>(
	sources: S[],
	maxLights = DEFAULT_MAX_LIGHTS
): S[] {
	const strongest = Math.max(0, ...sources.map((s) => s.strength));
	return sources
		.filter((s) => s.strength >= strongest * MIN_RELATIVE_STRENGTH)
		.sort((a, b) => b.strength - a.strength)
		.slice(0, maxLights);
}

export interface EmissiveLights {
	/**
	 * Rebuilds from what the scene draws now, so call it after anything is shown or hidden.
	 * `enabled` false removes every light.
	 */
	sync(enabled: boolean, maxLights?: number): void;
	dispose(): void;
}

/**
 * An emissive surface only looks bright, it lights nothing, so a look that wants real light from
 * glowing parts gets a point light at each lamp. A picked lamp stops casting shadows meanwhile, and
 * so does a dimmer glow around its light: a bulb or its diffuser would otherwise block the light.
 */
export function createEmissiveLights(scene: THREE.Scene): EmissiveLights {
	const lights: { key: THREE.PointLight; bounce: THREE.PointLight }[] = [];
	const silenced = new Set<THREE.Mesh>();

	const addLight = (shadowed: boolean) => {
		const key = new THREE.PointLight(0xffffff, 1, 0, 2);
		// No real bounce here, so anything outside the shade's cone would go flat. This stands in for
		// the room: light from the same place that the shade doesn't stop. Decay 1 falls off slower
		// than the key light, so it fills the room.
		const bounce = new THREE.PointLight(0xffffff, 1, 0, 1);
		if (shadowed) {
			key.castShadow = true;
			key.shadow.mapSize.setScalar(SHADOW_MAP_SIZE);
			key.shadow.radius = SHADOW_SOFTNESS;
			// Solve output only changes between syncs, and six faces every frame would sink orbiting.
			key.shadow.autoUpdate = false;
		}
		const pair = { key, bounce };
		lights.push(pair);
		scene.add(key, bounce);
		return pair;
	};

	const collect = () => {
		const content = new THREE.Box3();
		const parts: GlowingPart[] = [];
		// A hidden group hides its meshes without touching their own `.visible`.
		scene.traverseVisible((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh || object.userData.source !== SOURCE_COMPUTE) return;
			content.union(new THREE.Box3().setFromObject(mesh));
			const material = emissiveMaterialOf(mesh);
			if (!material) return;
			for (const bounds of drawnBounds(mesh)) parts.push({ mesh, material, bounds });
		});
		return { parts, radius: content.getSize(new THREE.Vector3()).length() / 2 };
	};

	const silence = (parts: GlowingPart[], sources: Source[]) => {
		for (const { mesh, bounds } of parts) {
			const blocksALight = sources.some(
				(source, index) =>
					source.meshes.has(mesh) || bounds.containsPoint(lights[index]!.key.position)
			);
			if (blocksALight && mesh.castShadow) {
				mesh.castShadow = false;
				silenced.add(mesh);
			}
		}
	};

	const sync = (enabled: boolean, maxLights = DEFAULT_MAX_LIGHTS) => {
		for (const mesh of silenced) mesh.castShadow = true;
		silenced.clear();

		const { parts, radius } = enabled ? collect() : { parts: [], radius: 0 };
		const sources = pickLightSources(sourcesFrom(parts, maxLights), maxLights);

		// Reused across solves: a new light reallocates its shadow map and recompiles every shader.
		sources.forEach((source, index) => {
			const { key, bounce } = lights[index] ?? addLight(index < MAX_SHADOWED_LIGHTS);
			const intensity = source.light ?? source.strength * INTENSITY_PER_STRENGTH * radius * radius;
			key.color.copy(source.color);
			// Lit windows across a facade end up as one light in its middle, which burns a hole in the
			// wall. Only the bounce's even wash suits a glow that wide. Zeroed, not removed: removing a
			// light recompiles every shader.
			const spread = source.bounds.getSize(new THREE.Vector3()).length() / 2 / radius;
			key.intensity = !source.light && spread > MAX_POINT_SOURCE_SPREAD ? 0 : intensity;
			source.bounds.getCenter(key.position);
			bounce.color.copy(source.color);
			// Over the radius because decay 1 scales with distance once, not squared like the key.
			bounce.intensity = (intensity * BOUNCE_SHARE) / radius;
			bounce.position.copy(key.position);
			if (key.castShadow) {
				key.shadow.camera.near = radius * 0.005;
				key.shadow.camera.far = radius * 4;
				// three only refreshes this on a change of `light.distance`, and ours stays 0.
				key.shadow.camera.updateProjectionMatrix();
				key.shadow.bias = -0.002;
				key.shadow.normalBias = radius * 0.002;
				key.shadow.needsUpdate = true;
			}
		});
		while (lights.length > sources.length) {
			const { key, bounce } = lights.pop()!;
			scene.remove(key, bounce);
			key.dispose();
			bounce.dispose();
		}
		silence(parts, sources);
	};

	return { sync, dispose: () => sync(false) };
}
