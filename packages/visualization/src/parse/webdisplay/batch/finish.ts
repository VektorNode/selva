import type * as THREE from 'three';

import type { SerializableMaterial } from '../types.js';

export type Finish = NonNullable<SerializableMaterial['finish']>;

export type ShaderPatch = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

/**
 * Scratch fibres across the grain: `pitch` mm apart, each segment `length` mm long (a range: real
 * brushing is many short fibres, not lines running the whole part), `depth` how far one scales
 * roughness, brightness by half, and tilts the normal across the grain so single fibres glint.
 */
interface Fibres {
	pitch: number;
	length: [min: number, max: number];
	depth: number;
}

/** Soft bands of fibres brushed harder or lighter: what still reads at wall distance. */
interface Bands {
	width: number;
	length: number;
	depth: number;
}

// Starting points, set by eye against photos of brushed stainless and mill-finish aluminium: tune
// against photos of real sheet, never against another render.
const RECIPES: Record<Finish, { fibres: Fibres[]; bands: Bands[] }> = {
	brushed: {
		fibres: [
			{ pitch: 0.04, length: [2, 12], depth: 0.3 },
			{ pitch: 0.25, length: [5, 40], depth: 0.18 }
		],
		bands: [
			{ width: 6, length: 500, depth: 0.08 },
			{ width: 1.5, length: 150, depth: 0.06 }
		]
	},
	rolled: {
		fibres: [{ pitch: 0.3, length: [80, 600], depth: 0.07 }],
		bands: [{ width: 20, length: 1500, depth: 0.05 }]
	}
};

// Radians of normal tilt per unit fibre depth.
const TILT = 0.6;

// Per doubling of cell width, unresolved fibres keep 2^-FIBRE_FADE of their spread. A true average
// is 0.5; slower keeps the few deep scratches that still read at wall distance in photos.
const FIBRE_FADE = 0.35;

const f = (n: number) => n.toFixed(4);

/** The shader patch for a finish, or null when it would draw nothing. `key` extends the program cache key. */
export function finishPatch(
	finish: Finish,
	strength: number
): { key: string; patch: ShaderPatch } | null {
	const recipe = RECIPES[finish];
	if (!recipe || !(strength > 0)) return null;

	const fibres =
		recipe.fibres
			.map(
				(fb, i) =>
					`selvaFibres( vUv, footprint, ${f(fb.pitch)}, vec2( ${f(fb.length[0])}, ${f(fb.length[1])} ), ${f(fb.depth)}, ${f(i * 31 + 3)} )`
			)
			.join(' + ') || '0.0';
	const bands =
		recipe.bands
			.map(
				(b) => `selvaBand( vUv, footprint, vec2( ${f(b.length)}, ${f(b.width)} ), ${f(b.depth)} )`
			)
			.join(' + ') || '0.0';

	const patch: ShaderPatch = (shader) => {
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				// Hash without sine: sin() loses precision on the large arguments mm UVs produce.
				float selvaHash( vec2 p ) {
					vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
					p3 += dot( p3, p3.yzx + 33.33 );
					return fract( ( p3.x + p3.y ) * p3.z );
				}
				float selvaNoise( vec2 p ) {
					vec2 i = floor( p );
					vec2 f = fract( p );
					vec2 s = f * f * ( 3.0 - 2.0 * f );
					return mix(
						mix( selvaHash( i ), selvaHash( i + vec2( 1.0, 0.0 ) ), s.x ),
						mix( selvaHash( i + vec2( 0.0, 1.0 ) ), selvaHash( i + vec2( 1.0, 1.0 ) ), s.x ),
						s.y
					);
				}
				// One row of fibres per pitch, hard-edged across the grain, each fibre its own depth and
				// tapered at both ends. A depth per row instead drew every row as one streak the height
				// of the part. depth * |depth| keeps most fibres faint and a few deep.
				float selvaFibreRow( vec2 uv, float pitch, vec2 len, float seed ) {
					float row = floor( uv.y / pitch );
					float l = mix( len.x, len.y, selvaHash( vec2( row, seed + 1.0 ) ) );
					float along = uv.x / l + selvaHash( vec2( row, seed + 2.0 ) );
					float seg = floor( along );
					float depth = selvaHash( vec2( row, seed + 3.0 + 1.618 * seg ) ) * 2.0 - 1.0;
					float t = along - seg;
					return depth * abs( depth ) * smoothstep( 0.0, 0.2, t ) * smoothstep( 1.0, 0.8, t );
				}
				// Below pixel size a cell 2^n rows wide stands for the rows it covers, at a reduced
				// spread: distance keeps the grain's texture without the shimmer of sampling single
				// fibres. Two levels blend so nothing pops while zooming.
				float selvaFibres( vec2 uv, float footprint, float pitch, vec2 len, float depth, float seed ) {
					float level = clamp( log2( footprint / pitch ) + 0.5, 0.0, 14.0 );
					float l0 = floor( level );
					float a = selvaFibreRow( uv, pitch * exp2( l0 ), len, seed + 7.0 * l0 ) * exp2( -${f(FIBRE_FADE)} * l0 );
					float b = selvaFibreRow( uv, pitch * exp2( l0 + 1.0 ), len, seed + 7.0 * l0 + 7.0 )
						* exp2( -${f(FIBRE_FADE)} * ( l0 + 1.0 ) );
					return depth * mix( a, b, level - l0 );
				}
				float selvaBand( vec2 uv, float footprint, vec2 size, float depth ) {
					float fade = 1.0 - smoothstep( 0.5, 1.0, footprint / size.y );
					return depth * fade * ( selvaNoise( uv / size ) * 2.0 - 1.0 );
				}`
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				float footprint = max( fwidth( vUv.y ), 1e-6 );
				float selvaFibre = ( ${fibres} ) * ${f(strength)};
				float selvaStreak = selvaFibre + ( ${bands} ) * ${f(strength)};
				diffuseColor.rgb *= 1.0 + 0.5 * selvaStreak;`
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
				roughnessFactor = clamp( roughnessFactor * ( 1.0 + selvaStreak ), 0.0, 1.0 );`
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
				#ifdef USE_ANISOTROPY
					vec3 selvaAcross = tbn[ 1 ];
				#else
					// V's direction from screen derivatives, as three's getTangentFrame.
					vec3 selvaQ0 = dFdx( - vViewPosition );
					vec3 selvaQ1 = dFdy( - vViewPosition );
					vec3 selvaAcross = cross( selvaQ1, normal ) * dFdx( vUv ).y + cross( normal, selvaQ0 ) * dFdy( vUv ).y;
					selvaAcross *= inversesqrt( max( dot( selvaAcross, selvaAcross ), 1e-12 ) );
				#endif
				normal = normalize( normal + ${f(TILT)} * selvaFibre * selvaAcross );`
			);
	};

	return { key: `finish:${finish}:${f(strength)}`, patch };
}
