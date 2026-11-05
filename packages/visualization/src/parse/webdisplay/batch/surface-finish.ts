import type { Finish, ShaderPatch } from './finish.js';

const f = (n: number) => n.toFixed(4);

/**
 * One species of wood, drawn from Part-mapped UVs: U along the grain, V across the face, both in mm.
 * A plank is sawn some way from the pith, so its growth rings meet the face at a slant:
 * `sqrt(pith² + s²)` across a plank's width, plus a slow lean along it (a tree's taper), draws the
 * arches of a flat-sawn board, with rings showing wider on the face than they grew. Planks are
 * `PLANK` mm wide, each with its own pith distance and ring phase, which reads as a glued-up panel.
 * Two UV channels can't give exact rings on end grain; there they show as straight lines.
 */
interface Wood {
	/** Mm between growth rings, on average. */
	ring: number;
	/** How much darker latewood is than earlywood, 0 to 1. */
	latewood: number;
	/** Share of each ring that is latewood: a broad band in oak, a hairline in maple. */
	band: number;
	/** Open pores as short dark dashes along the grain, 0 to 1: walnut and oak show them most. */
	pores: number;
	/** Broad dark and light streaks along the grain, 0 to 1. They survive any distance. */
	streaks: number;
}

// Mm from the pith to a plank's face, the least and the spread: boards come from 250–500 mm logs.
// Closer in, rings cross the face at nearly their own spacing and read as combed softwood.
const PITH = 120;
const PITH_SPREAD = 120;
const PLANK = 180;
// Rings gained per mm along the grain: one every half metre or so at 5 mm rings.
const LEAN = 0.0105;

const wood = ({ ring, latewood, band, pores, streaks }: Wood) => /* glsl */ `
		float plank = floor( uv.y / ${f(PLANK)} );
		float s = uv.y - ( plank + 0.5 ) * ${f(PLANK)};
		float pith = ${f(PITH)} + selvaHash( vec2( plank, 2.0 ) ) * ${f(PITH_SPREAD)};
		// Rings wander a few mm and vary in spacing, as growth does from year to year.
		float wander = ( selvaFbm( uv * vec2( 0.003, 0.008 ) ) - 0.5 ) * ${f(ring * 2)};
		float r = sqrt( pith * pith + s * s ) + uv.x * ${f(LEAN)} + wander;
		r += selvaFbm( vec2( r * 0.02, plank ) ) * ${f(ring * 3)} + selvaHash( vec2( plank, 1.0 ) ) * ${f(ring * 20)};
		float year = fract( r / ${f(ring)} );
		float late = smoothstep( ${f(1 - band)}, ${f(1 - band * 0.4)}, year ) * ( 1.0 - smoothstep( 0.95, 1.0, year ) );
		// Open-pored wood shows its rings as a broken band of pores, not a clean line.
		late *= 1.0 - ${f(pores * 0.6)} * ( 1.0 - smoothstep( 0.3, 0.7, selvaNoise( uv * vec2( 0.25, 2.0 ) ) ) );
		late *= selvaDetail( ${f(ring)} );
		float fibre = ( selvaNoise( uv * vec2( 0.04, 1.6 ) ) - 0.5 ) * selvaDetail( 1.0 );
		float pore = smoothstep( 0.62, 0.8, selvaNoise( uv * vec2( 0.3, 2.5 ) ) ) * ( 1.0 - 0.6 * late );
		pore *= ${f(pores)} * selvaDetail( 0.8 );
		float streak = ( selvaFbm( uv * vec2( 0.0015, 0.012 ) ) - 0.5 ) * ${f(streaks)};
		float shade = 1.0 + ${f(latewood * band)} - late * ${f(latewood)} + fibre * 0.1 - pore * 0.45 + streak * 0.6;
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
	// Generic mid-tone hardwood: ash, elm, cherry.
	wood: wood({ ring: 4, latewood: 0.3, band: 0.4, pores: 0.4, streaks: 0.35 }),
	// Soft rings; open pores are what you see.
	walnut: wood({ ring: 5, latewood: 0.2, band: 0.4, pores: 1, streaks: 0.45 }),
	// Coarse, open-pored, tight arches.
	oak: wood({ ring: 3, latewood: 0.3, band: 0.35, pores: 0.9, streaks: 0.25 }),
	// Fine and pale: rings barely show, no open pores.
	maple: wood({ ring: 3, latewood: 0.2, band: 0.1, pores: 0, streaks: 0.12 }),
	// Dark, with tight black and brown bands at high contrast.
	wenge: wood({ ring: 1.5, latewood: 0.7, band: 0.5, pores: 0.6, streaks: 0.4 }),
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
	// Honed limestone: a soft cloud and mottle, faint bedding, and shell and fossil flecks.
	limestone: /* glsl */ `
		float cloud = ( selvaFbm( uv * 0.004 ) - 0.5 ) * selvaDetail( 60.0 );
		float mottle = ( selvaFbm( uv * 0.025 + vec2( 3.0, 7.0 ) ) - 0.5 ) * selvaDetail( 12.0 );
		float bed = ( selvaNoise( vec2( uv.x * 0.003, uv.y * 0.05 ) ) - 0.5 ) * selvaDetail( 10.0 );
		float fleck = smoothstep( 0.8, 0.9, selvaNoise( uv * 0.5 ) ) * selvaDetail( 2.0 );
		vec3 fossil = selvaCell( uv / 14.0 );
		float shell = ( 1.0 - smoothstep( 0.08, 0.16, fossil.x ) ) * step( 0.85, fossil.z ) * selvaDetail( 6.0 );
		tone = vec3( 1.0 + cloud * 0.14 + mottle * 0.1 + bed * 0.03 - fleck * 0.12 - shell * 0.1 );
		gloss = 1.0 + cloud * 0.1;
		height = -( fleck + shell ) * 0.00005;`,
	// Soft wavy bands with open voids, up to a few cm long, stretched along the bedding.
	travertine: /* glsl */ `
		float band = selvaFbm( vec2( uv.x * 0.002, uv.y * 0.012 ) );
		float layer = ( band - 0.5 ) * selvaDetail( 25.0 );
		float pocket = selvaNoise( uv * vec2( 0.025, 0.15 ) ) * 0.7 + selvaNoise( uv * vec2( 0.08, 0.4 ) ) * 0.3;
		float voids = smoothstep( 0.68, 0.78, pocket ) * smoothstep( 0.35, 0.6, band ) * selvaDetail( 4.0 );
		float grain = ( selvaNoise( uv * 0.6 ) - 0.5 ) * selvaDetail( 1.5 );
		tone = vec3( 1.0 + layer * 0.2 + grain * 0.04 ) * mix( vec3( 1.0 ), vec3( 0.62, 0.56, 0.48 ), voids );
		gloss = 1.0 + voids * 0.3;
		height = -voids * 0.002;`,
	// Salt and pepper: crystals about 4 mm. Flamed, so the face is rough to the touch.
	granite: /* glsl */ `
		vec3 crystal = selvaCell( uv / 4.0 );
		// Feldspar, quartz and biotite in about the shares of a grey granite. The dark crystals
		// gather in clusters, which is what still reads as granite from a few metres.
		float cluster = selvaFbm( uv * 0.04 ) - 0.5;
		float dark = 0.2 + cluster * 0.2;
		float mineral = crystal.z < dark ? 0.35 : ( crystal.z < dark + 0.3 ? 1.35 : 1.0 );
		mineral *= 1.0 + ( selvaHash( vec2( crystal.z, 3.0 ) ) - 0.5 ) * 0.15;
		mineral = mix( 1.0 - cluster * 0.25 * selvaDetail( 15.0 ), mineral, selvaDetail( 4.0 ) );
		float cloud = ( selvaFbm( uv * 0.005 ) - 0.5 ) * selvaDetail( 50.0 );
		tone = vec3( mineral + cloud * 0.06 );
		gloss = 1.0 - ( mineral - 1.0 ) * 0.15;
		height = ( selvaNoise( uv * 0.8 ) - 0.5 ) * 0.0002 * selvaDetail( 1.2 );`,
	// Soft grey veins through a white ground, drifting on a diagonal and feathering out, like Carrara.
	marble: /* glsl */ `
		vec2 w = vec2( uv.x * 0.7 + uv.y * 0.7, uv.y * 0.7 - uv.x * 0.7 ) * vec2( 0.0012, 0.004 );
		w += vec2( selvaFbm( w * 2.0 ), selvaFbm( w * 2.0 + vec2( 4.0, 2.0 ) ) ) * 0.6;
		float feather = smoothstep( 0.3, 0.7, selvaFbm( uv * 0.006 + vec2( 2.0, 5.0 ) ) );
		float major = 1.0 - smoothstep( 0.0, 0.05, abs( selvaFbm( w ) - 0.5 ) );
		float fine = 1.0 - smoothstep( 0.0, 0.02, abs( selvaFbm( w * 3.0 + vec2( 9.0, 1.0 ) ) - 0.5 ) );
		float cloud = ( selvaFbm( uv * 0.003 ) - 0.5 ) * selvaDetail( 60.0 );
		float vein = ( major * 0.35 * selvaDetail( 6.0 ) + fine * 0.2 * selvaDetail( 2.0 ) ) * feather;
		tone = vec3( 1.0 + cloud * 0.06 - vein - feather * 0.04 );
		gloss = 1.0 + vein * 0.3;`,
	// Natural cleft: flaked terraces a millimetre or two deep, catching the light at their edges.
	slate: /* glsl */ `
		float cleft = selvaFbm( uv * vec2( 0.012, 0.02 ) );
		float flake = mix( cleft, floor( cleft * 4.0 ) / 4.0, 0.6 );
		float seen = selvaDetail( 6.0 );
		float glint = ( selvaNoise( uv * 0.3 ) - 0.5 ) * selvaDetail( 3.0 );
		tone = vec3( 1.0 + ( flake - 0.5 ) * 0.18 * seen + glint * 0.06 );
		gloss = 1.0 - ( flake - 0.5 ) * 0.3 * seen + glint * 0.2;
		height = flake * 0.0015 * seen;`,
	// Stone chips up to about 9 mm and grit in a pale cement, ground flat.
	terrazzo: /* glsl */ `
		vec3 chipCell = selvaCell( uv / 9.0 );
		float chip = smoothstep( 0.1, 0.16, chipCell.y - chipCell.x ) * step( 0.12, selvaHash( vec2( chipCell.z, 5.0 ) ) );
		float k = selvaHash( vec2( chipCell.z, 7.0 ) );
		vec3 stone = k < 0.6 ? vec3( 1.1 ) : k < 0.75 ? vec3( 0.65 ) : k < 0.85 ? vec3( 0.22 ) : k < 0.9 ? vec3( 0.85, 0.69, 0.44 ) : k < 0.95 ? vec3( 0.64, 0.35, 0.28 ) : vec3( 0.93, 0.72, 0.66 );
		vec3 gritCell = selvaCell( uv / 2.5 );
		float grit = smoothstep( 0.1, 0.2, gritCell.y - gritCell.x ) * step( 0.6, selvaHash( vec2( gritCell.z, 2.0 ) ) );
		float g = selvaHash( vec2( gritCell.z, 9.0 ) ) < 0.5 ? 0.4 : 1.1;
		vec3 near = mix( vec3( 1.0 ), stone, chip );
		near = mix( near, vec3( g ), grit * ( 1.0 - chip ) * selvaDetail( 2.5 ) );
		// From afar the chips average to a slightly darker matrix.
		tone = mix( vec3( 0.92 ), near, selvaDetail( 9.0 ) );
		gloss = 1.0 + chip * 0.1;`,
	// Concrete slabs 600 x 400 mm in half bond, 5 mm joints and a small chamfer, each slab its own tone.
	paving: /* glsl */ `
		vec2 size = vec2( 600.0, 400.0 );
		float row = floor( uv.y / size.y );
		vec2 laid = vec2( uv.x + mod( row, 2.0 ) * size.x * 0.5, uv.y );
		vec2 id = floor( laid / size );
		vec2 edge = abs( fract( laid / size ) - 0.5 ) * size;
		float inset = min( size.x * 0.5 - edge.x, size.y * 0.5 - edge.y );
		float joint = ( 1.0 - smoothstep( 2.5, 3.5, inset ) ) * selvaDetail( 5.0 );
		float chamfer = ( 1.0 - smoothstep( 2.5, 6.0, inset ) ) * selvaDetail( 4.0 );
		float slab = ( selvaHash( id ) - 0.5 ) * 0.12 * selvaDetail( 100.0 );
		float blotch = ( selvaFbm( uv * 0.006 ) - 0.5 ) * 0.12 * selvaDetail( 40.0 );
		float speck = ( selvaNoise( uv * 0.7 ) - 0.5 ) * 0.06 * selvaDetail( 1.5 );
		tone = vec3( 1.0 + slab + blotch + speck ) * mix( 1.0, 0.55, joint );
		gloss = 1.0 + joint * 0.1;
		height = -chamfer * 0.002 - joint * 0.003;`,
	// Split granite setts about 110 x 100 mm in rows, sand joints, domed and uneven.
	setts: /* glsl */ `
		vec2 size = vec2( 110.0, 100.0 );
		vec2 warped = uv + ( vec2( selvaNoise( uv * 0.03 ), selvaNoise( uv * 0.03 + vec2( 3.0, 8.0 ) ) ) - 0.5 ) * 10.0;
		float row = floor( warped.y / size.y );
		vec2 laid = vec2( warped.x + selvaHash( vec2( row, 4.0 ) ) * size.x, warped.y );
		vec2 id = floor( laid / size );
		vec2 edge = abs( fract( laid / size ) - 0.5 ) * size;
		float inset = min( size.x * 0.5 - edge.x, size.y * 0.5 - edge.y );
		float joint = ( 1.0 - smoothstep( 4.0, 6.0, inset ) ) * selvaDetail( 10.0 );
		float dome = smoothstep( 4.0, 25.0, inset );
		vec3 crystal = selvaCell( uv / 4.0 );
		// Feldspar, quartz and biotite in about the shares of a grey granite. The dark crystals
		// gather in clusters, which is what still reads as granite from a few metres.
		float cluster = selvaFbm( uv * 0.04 ) - 0.5;
		float dark = 0.2 + cluster * 0.2;
		float mineral = crystal.z < dark ? 0.35 : ( crystal.z < dark + 0.3 ? 1.35 : 1.0 );
		mineral *= 1.0 + ( selvaHash( vec2( crystal.z, 3.0 ) ) - 0.5 ) * 0.15;
		mineral = mix( 1.0 - cluster * 0.25 * selvaDetail( 15.0 ), mineral, selvaDetail( 4.0 ) );
		float tint = selvaHash( id + vec2( 5.0, 2.0 ) ) - 0.5;
		vec3 sett = ( 1.0 + ( selvaHash( id ) - 0.5 ) * 0.16 ) * ( 1.0 + vec3( 0.05, 0.0, -0.06 ) * tint * 2.0 );
		sett = mix( vec3( 1.0 ), sett, selvaDetail( 100.0 ) );
		tone = mix( sett * mineral, vec3( 1.05, 0.97, 0.82 ), joint );
		gloss = 1.0 + joint * 0.1;
		height = ( dome * 0.006 + ( selvaNoise( uv * 0.15 ) - 0.5 ) * 0.001 ) * selvaDetail( 10.0 );`,
	// Rounded stones about 12 mm, with shadowed gaps between them.
	gravel: /* glsl */ `
		vec3 pebble = selvaCell( uv / 12.0 );
		float gap = 1.0 - smoothstep( 0.04, 0.18, pebble.y - pebble.x );
		float dome = sqrt( clamp( 1.0 - pebble.x * 1.4, 0.0, 1.0 ) );
		float k = selvaHash( vec2( pebble.z, 3.0 ) );
		vec3 stone = k < 0.3 ? vec3( 1.13, 1.14, 1.11 ) : k < 0.55 ? vec3( 0.96, 0.85, 0.71 ) : k < 0.7 ? vec3( 0.84, 0.64, 0.59 ) : k < 0.9 ? vec3( 0.74, 0.8, 0.89 ) : vec3( 0.47, 0.5, 0.56 );
		stone *= 1.0 + ( selvaHash( vec2( pebble.z, 8.0 ) ) - 0.5 ) * 0.15;
		float seen = selvaDetail( 12.0 );
		tone = mix( vec3( 0.85 ), stone * mix( 1.0, 0.35, gap ) * ( 0.85 + 0.15 * dome ), seen );
		gloss = 1.0 + gap * 0.1 - dome * 0.1;
		height = dome * 0.004 * seen;`,
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
				// Cellular noise: distance to the nearest and second-nearest jittered point, and the
				// nearest one's id. y - x is small along a cell border.
				vec3 selvaCell( vec2 p ) {
					vec2 i = floor( p );
					vec2 fp = fract( p );
					float f1 = 8.0;
					float f2 = 8.0;
					float id = 0.0;
					for ( int y = -1; y <= 1; y ++ ) {
						for ( int x = -1; x <= 1; x ++ ) {
							vec2 g = vec2( float( x ), float( y ) );
							vec2 o = vec2( selvaHash( i + g ), selvaHash( i + g + vec2( 19.0, 7.0 ) ) );
							float d = length( g + o * 0.8 + 0.1 - fp );
							if ( d < f1 ) {
								f2 = f1;
								f1 = d;
								id = selvaHash( i + g + vec2( 3.0, 11.0 ) );
							} else if ( d < f2 ) {
								f2 = d;
							}
						}
					}
					return vec3( f1, f2, id );
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
