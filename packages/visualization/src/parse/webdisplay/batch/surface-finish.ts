import type { Finish, ShaderPatch } from './finish.js';

const f = (n: number) => n.toFixed(4);

/**
 * One species of wood, drawn from Part-mapped UVs: U along the grain, V across the face, both in mm.
 * A plank is sawn beside the pith, so its growth rings meet the face at a slant: `sqrt(PITH² + s²)`
 * across a plank's width, plus a slow lean along it (a tree's taper), draws the arches of a flat-sawn
 * board. Planks are `PLANK` mm wide, each with its own ring phase, which reads as a glued-up panel.
 * Two UV channels can't give exact rings on end grain; there they show as straight lines.
 */
interface Wood {
	/** Mm between growth rings, on average. */
	ring: number;
	/** How much darker latewood is than earlywood, 0 to 1. */
	latewood: number;
	/** Open pores as dark flecks along the grain, 0 to 1: oak and ash have them, maple does not. */
	pores: number;
	/** Broad dark and light streaks along the grain, 0 to 1. They survive any distance. */
	streaks: number;
}

const PITH = 40;
const PLANK = 250;
// Rings gained per mm along the grain: one every half metre or so at 5 mm rings.
const LEAN = 0.0105;

const wood = ({ ring, latewood, pores, streaks }: Wood) => /* glsl */ `
		float plank = floor( uv.y / ${f(PLANK)} );
		float s = uv.y - ( plank + 0.5 ) * ${f(PLANK)};
		// Rings wander a few mm and vary in spacing, as growth does from year to year.
		float wander = ( selvaFbm( uv * vec2( 0.004, 0.05 ) ) - 0.5 ) * ${f(ring * 1.5)};
		float r = sqrt( ${f(PITH * PITH)} + s * s ) + uv.x * ${f(LEAN)} + wander;
		r += selvaFbm( vec2( r * 0.02, plank ) ) * ${f(ring * 3)} + selvaHash( vec2( plank, 1.0 ) ) * ${f(ring * 20)};
		float year = fract( r / ${f(ring)} );
		float late = smoothstep( 0.55, 0.9, year ) * ( 1.0 - smoothstep( 0.93, 1.0, year ) );
		late *= selvaDetail( ${f(ring)} );
		float fibre = ( selvaNoise( uv * vec2( 0.04, 1.6 ) ) - 0.5 ) * selvaDetail( 1.0 );
		float pore = smoothstep( 0.72, 0.9, selvaNoise( uv * vec2( 0.3, 3.5 ) ) ) * ( 1.0 - late );
		pore *= ${f(pores)} * selvaDetail( 0.6 );
		float streak = ( selvaFbm( uv * vec2( 0.0015, 0.012 ) ) - 0.5 ) * ${f(streaks)};
		float shade = 1.0 + 0.12 * ${f(latewood)} - late * ${f(latewood)} + fibre * 0.12 - pore * 0.5 + streak * 0.6;
		tone = vec3( shade );
		gloss = 1.0 + late * 0.08 + pore * 0.4 - fibre * 0.2;
		height = ( fibre * 0.00008 - pore * 0.00015 ) * selvaDetail( 0.6 );`;

/**
 * Procedural surfaces, so a preset looks like its material with no texture files to ship or upload.
 * UVs are millimetres, so a brick is brick-sized at any model scale. Each recipe sets `tone` (albedo
 * multiplier), `gloss` (roughness multiplier) and `height` (relief in metres, to match the viewer).
 * Every pattern goes through `selvaDetail`, colour included: a noise cell or a brick under a pixel
 * samples to static, so a whole building has to settle to its flat colour.
 */
const RECIPES: Partial<Record<Finish, string>> = {
	// Generic hardwood: walnut, cherry, beech.
	wood: wood({ ring: 5, latewood: 0.35, pores: 0.25, streaks: 0.35 }),
	// Coarse, open-pored, strongly figured.
	oak: wood({ ring: 4, latewood: 0.45, pores: 0.9, streaks: 0.25 }),
	// Fine and pale: rings barely show, no open pores.
	maple: wood({ ring: 3, latewood: 0.15, pores: 0, streaks: 0.15 }),
	// Dark, with tight black and brown bands.
	wenge: wood({ ring: 2.5, latewood: 0.7, pores: 0.6, streaks: 0.5 }),
	// Slow blotches from the pour, plus bug holes.
	concrete: /* glsl */ `
		float blotch = ( selvaFbm( uv * 0.0035 ) - 0.5 ) * selvaDetail( 40.0 );
		float holes = smoothstep( 0.8, 0.88, selvaNoise( uv * 0.22 ) ) * selvaDetail( 5.0 );
		float speck = selvaNoise( uv * 0.9 ) - 0.5;
		tone = vec3( 1.0 + blotch * 0.26 + speck * 0.05 * selvaDetail( 1.0 ) - holes * 0.2 );
		gloss = 1.0 + blotch * 0.3;
		height = -holes * 0.0005;`,
	// Hand-trowelled: all relief, barely any colour.
	plaster: /* glsl */ `
		float trowel = 0.5 + ( selvaFbm( uv * 0.05 ) - 0.5 ) * selvaDetail( 6.0 );
		tone = vec3( 1.0 + ( trowel - 0.5 ) * 0.07 );
		gloss = 1.0 + ( trowel - 0.5 ) * 0.2;
		height = trowel * 0.0007;`,
	// Running bond at the standard 215 x 65 mm with 10 mm joints. Every brick its own tone.
	brick: /* glsl */ `
		vec2 course = vec2( 225.0, 75.0 );
		float row = floor( uv.y / course.y );
		vec2 laid = vec2( uv.x + mod( row, 2.0 ) * course.x * 0.5, uv.y );
		vec2 id = floor( laid / course );
		vec2 edge = abs( fract( laid / course ) - 0.5 ) * course;
		float joint = 1.0 - smoothstep( 0.0, 1.5, min( course.x * 0.5 - 5.0 - edge.x, course.y * 0.5 - 5.0 - edge.y ) );
		joint *= selvaDetail( 10.0 );
		float face = 1.0 + ( ( selvaHash( id ) - 0.5 ) * 0.48 + ( selvaFbm( uv * 0.05 ) - 0.5 ) * 0.25 ) * selvaDetail( 65.0 );
		tone = mix( vec3( face ), vec3( 1.5, 1.7, 1.8 ), joint );
		gloss = 1.0 + joint * 0.15;
		height = -joint * 0.005;`,
	// Spark-eroded mould grain, as on injection-moulded housings: pits about 0.6 mm over a 2 mm
	// mottle, coarse enough to read at arm's length. Under a pixel it settles to the material's own
	// roughness.
	molded: /* glsl */ `
		float pit = selvaNoise( uv * 1.6 );
		float mottle = selvaNoise( uv * 0.5 + vec2( 7.0, 3.0 ) );
		float grit = ( pit * 0.65 + mottle * 0.35 ) - 0.5;
		float seen = selvaDetail( 0.6 );
		tone = vec3( 1.0 + grit * 0.1 * seen );
		gloss = 1.0 + grit * 0.9 * seen;
		height = ( grit + 0.5 ) * 0.00008 * seen;`,
	// Weathering steel: orange bloom over dark scale, streaking down the sheet.
	corten: /* glsl */ `
		float bloom = 0.5 + ( selvaFbm( uv * vec2( 0.006, 0.0025 ) ) - 0.5 ) * selvaDetail( 25.0 );
		float scale = 0.5 + ( selvaFbm( uv * 0.06 ) - 0.5 ) * selvaDetail( 8.0 );
		tone = mix( vec3( 0.62, 0.52, 0.46 ), vec3( 1.28, 1.08, 0.9 ), smoothstep( 0.32, 0.68, bloom ) );
		tone *= 1.0 + ( scale - 0.5 ) * 0.3;
		gloss = 1.0 + ( scale - 0.5 ) * 0.25;
		height = scale * 0.0004;`
};

/** Null for the finishes `finish.ts` draws itself. */
export function surfacePatch(
	finish: Finish,
	strength: number
): { key: string; patch: ShaderPatch } | null {
	const recipe = RECIPES[finish];
	if (!recipe || !(strength > 0)) return null;

	const patch: ShaderPatch = (shader) => {
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				`#include <common>
				float selvaFootprint;
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
				float selvaFbm( vec2 p ) {
					float sum = 0.0;
					float amplitude = 0.5;
					for ( int i = 0; i < 4; i ++ ) {
						sum += amplitude * selvaNoise( p );
						p = p * 2.03 + vec2( 17.0, 9.0 );
						amplitude *= 0.5;
					}
					return sum / 0.9375;
				}
				float selvaDetail( float featureMm ) {
					return 1.0 - smoothstep( 0.5, 1.5, selvaFootprint / featureMm );
				}`
			)
			.replace(
				'#include <color_fragment>',
				`#include <color_fragment>
				selvaFootprint = max( max( fwidth( vUv.x ), fwidth( vUv.y ) ), 1e-6 );
				vec2 uv = vUv;
				vec3 tone = vec3( 1.0 );
				float gloss = 1.0;
				float height = 0.0;
				${recipe}
				diffuseColor.rgb *= mix( vec3( 1.0 ), tone, ${f(strength)} );`
			)
			.replace(
				'#include <roughnessmap_fragment>',
				`#include <roughnessmap_fragment>
				roughnessFactor = clamp( roughnessFactor * mix( 1.0, gloss, ${f(strength)} ), 0.0, 1.0 );`
			)
			.replace(
				'#include <normal_fragment_maps>',
				`#include <normal_fragment_maps>
				{
					// Bump from screen derivatives, as three's perturbNormalArb.
					vec3 dx = dFdx( - vViewPosition );
					vec3 dy = dFdy( - vViewPosition );
					vec3 r1 = cross( dy, normal );
					vec3 r2 = cross( normal, dx );
					float det = dot( dx, r1 ) * faceDirection;
					vec3 grad = sign( det ) * ( dFdx( height ) * r1 + dFdy( height ) * r2 ) * ${f(strength)};
					normal = normalize( abs( det ) * normal - grad );
				}`
			);
	};

	return { key: `surface:${finish}:${f(strength)}`, patch };
}
