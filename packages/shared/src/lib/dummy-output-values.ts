import * as THREE from 'three';
import chart from '$lib/dummy-surface-chart.json';

// ─── 3D mesh ────────────────────────────────────────────────────────────────
export const cubeMesh = new THREE.Mesh(
	new THREE.BoxGeometry(1, 1, 1, 4, 4, 4),
	new THREE.MeshStandardMaterial({ color: 0x4a90d9, metalness: 0.3, roughness: 0.4 })
);

// ─── Plotly figures — add/edit charts here ──────────────────────────────────
// Paste fig.to_json() output directly as a template literal — no cleanup needed.


const contourPlot = `{"data":[{"z":[[10,10.625,12.5,15.625,20],[5.625,6.25,8.125,11.25,15.625],[2.5,3.125,5.0,8.125,12.5],[0.625,1.25,3.125,6.25,10.625],[0,0.625,2.5,5.625,10]],"type":"contour","colorscale":"Viridis","contours":{"coloring":"heatmap"},"showscale":true}],"layout":{"title":{"text":"Basic Contour Plot"}}}`;

// ─── All output values ───────────────────────────────────────────────────────
export const dummyOutputValues: Record<string, unknown> = {
	'output-001': 'Computation completed successfully. All 12 parameters are within bounds.',
	'output-002': 4827.63,
	'output-003': [
		{
			fileName: 'result_geometry_SZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
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
	'output-008': contourPlot
};
