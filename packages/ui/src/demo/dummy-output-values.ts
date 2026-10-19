import * as THREE from 'three';
import chart from './dummy-surface-chart.json';
import meshData from './example-mesh.json';
import {
	parseMeshBatchObject,
	parseDisplayItems,
	type DisplayBatch
} from '@selvajs/visualization/parse';

// Synchronous stand-in for callers that can't await `getParsedMeshes`.
export const cubeMesh = new THREE.Mesh(
	new THREE.BoxGeometry(1, 1, 1, 4, 4, 4),
	new THREE.MeshStandardMaterial({ color: 0x4a00d9, metalness: 0.3, roughness: 0.4 })
);

cubeMesh.userData = {
	fileName: 'cube_mesh',
	category: 'demo',
	timestamp: Date.now()
} as Record<string, any>;

cubeMesh.name = 'cube_mesh';

// Mirrors the real solve driver: `parseMeshBatchObject` builds the meshes,
// `parseDisplayItems` builds the points/curves.
export async function getParsedMeshes() {
	// JSON imports widen `kind` to `string`; the batch's runtime shape matches DisplayBatch.
	const batch = meshData as unknown as DisplayBatch;

	const objects: THREE.Object3D[] = await parseMeshBatchObject(batch, { debug: false });

	const items = batch.items;
	if (items?.length) {
		objects.push(...parseDisplayItems(items));
	}

	return objects;
}

// Paste fig.to_json() output directly as a template literal — no cleanup needed.
const contourPlot = `{"data":[{"z":[[10,10.625,12.5,15.625,20],[5.625,6.25,8.125,11.25,15.625],[2.5,3.125,5.0,8.125,12.5],[0.625,1.25,3.125,6.25,10.625],[0,0.625,2.5,5.625,10]],"type":"contour","colorscale":"Viridis","contours":{"coloring":"heatmap"},"showscale":true}],"layout":{"title":{"text":"Basic Contour Plot"}}}`;

export const dummyOutputValues: Record<string, unknown> = {
	'output-001': 'Computation completed successfully. All 12 parameters are within bounds.',
	'output-002': 4827.63,
	'output-003': [
		{
			fileName: 'result',
			fileType: '.obj',
			data: btoa('# Wavefront OBJ\nv 0.0 0.0 0.0\nv 1.0 0.0 0.0\nv 0.0 1.0 0.0\nf 1 2 3'),
			isBase64Encoded: true
		}
	],
	'output-004':
		'[INFO]  Step 1: Parameter validation ............. OK\n[INFO]  Step 2: Mesh generation .................. OK\n[INFO]  Step 3: Geometry export .................. OK\n[WARN]  High vertex count detected (12 480 faces).',
	'output-005': 892,
	'output-006': [
		{
			fileName: 'panel_A',
			fileType: '.3dm',
			subFolder: 'panels',
			data: btoa('3dm-binary-content-panel-A'),
			isBase64Encoded: true
		},
		{
			fileName: 'panel_B',
			fileType: '.3dm',
			subFolder: 'panels',
			data: btoa('3dm-binary-content-panel-B'),
			isBase64Encoded: true
		},
		{
			fileName: 'main_frame',
			fileType: '.3dm',
			subFolder: 'structure',
			data: btoa('3dm-binary-content-frame'),
			isBase64Encoded: true
		},
		{
			fileName: 'metadata',
			fileType: '.json',
			data: btoa(JSON.stringify({ version: '1.0', panelCount: 2, generatedAt: '2026-03-10' })),
			isBase64Encoded: true
		}
	],
	'output-007': JSON.stringify(chart),
	'output-008': contourPlot,
	'output-009': [
		{
			fileName: 'preview',
			fileType: '.svg',
			data: `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e8eef5"/><polygon points="200,40 340,120 340,220 200,280 60,220 60,120" fill="#4f7cac" stroke="#2c4a6b" stroke-width="4"/><polygon points="200,40 340,120 200,190 60,120" fill="#7fa6cf"/><line x1="200" y1="190" x2="200" y2="280" stroke="#2c4a6b" stroke-width="4"/></svg>`,
			isBase64Encoded: false
		},
		{
			// Hairlines and tiny labels, to check that zooming keeps fine detail sharp.
			fileName: 'detail',
			fileType: '.svg',
			data: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#fff"/><g stroke="#cbd5e1" stroke-width="0.5">${Array.from({ length: 81 }, (_, i) => `<line x1="${i * 20}" y1="0" x2="${i * 20}" y2="1000"/>`).join('')}${Array.from({ length: 51 }, (_, i) => `<line x1="0" y1="${i * 20}" x2="1600" y2="${i * 20}"/>`).join('')}</g><g font-family="monospace" font-size="4" fill="#334155">${Array.from({ length: 40 }, (_, i) => `<text x="${i * 40 + 2}" y="6">${i * 40}</text>`).join('')}</g><circle cx="800" cy="500" r="300" fill="none" stroke="#2563eb" stroke-width="0.75"/><path d="M200 800 Q 800 100 1400 800" fill="none" stroke="#dc2626" stroke-width="0.5"/></svg>`,
			isBase64Encoded: false
		}
	]
};
