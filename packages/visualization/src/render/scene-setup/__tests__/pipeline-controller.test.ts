import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedOptions } from '../defaults.js';
import { createPipelineController } from '../pipeline-controller.js';

const createRenderPipeline = vi.hoisted(() => vi.fn());
vi.mock('../../render-pipeline.js', () => ({ createRenderPipeline }));

const bloom = { strength: 1, radius: 0.5, threshold: 1 };

function controller(render: Partial<ResolvedOptions['render']>) {
	const config = { render } as ResolvedOptions;
	const pipeline = createPipelineController({
		renderer: {} as THREE.WebGLRenderer,
		scene: new THREE.Scene(),
		getActiveCamera: () => new THREE.PerspectiveCamera(),
		getCanvasSize: () => ({ width: 100, height: 100 }),
		config,
		requestRender: () => {}
	});
	return { config, pipeline };
}

describe('createPipelineController', () => {
	beforeEach(() => {
		createRenderPipeline.mockReset();
		createRenderPipeline.mockImplementation(() => ({
			setSize: () => {},
			setEdgeDetection: () => {},
			dispose: () => {}
		}));
	});

	it('keeps a composer for bloom with ambient occlusion off', () => {
		const { pipeline } = controller({ ambientOcclusion: true, bloom });

		pipeline.setAmbientOcclusion(false);

		expect(pipeline.get()).not.toBeNull();
	});

	it('does not rebuild when nothing it baked in changed', () => {
		const { pipeline } = controller({ ambientOcclusion: true, bloom });
		pipeline.sync();

		pipeline.setAmbientOcclusion(true);
		pipeline.sync();

		expect(createRenderPipeline).toHaveBeenCalledTimes(1);
	});

	it.each([
		['bloom', { bloom: { ...bloom, strength: 2 } }],
		['tone mapping', { toneMapping: THREE.ACESFilmicToneMapping }],
		['exposure', { toneMappingExposure: 2 }]
	])('rebuilds when %s changes', (_, change) => {
		const { config, pipeline } = controller({ ambientOcclusion: true, bloom });
		pipeline.sync();

		Object.assign(config.render, change);
		pipeline.sync();

		expect(createRenderPipeline).toHaveBeenCalledTimes(2);
	});
});
