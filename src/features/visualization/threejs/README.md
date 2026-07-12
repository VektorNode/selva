# Three.js Integration for Rhino Compute

This module provides utilities for visualizing Rhino geometry in Three.js. It includes scene
initialization, mesh handling, material definitions, and compression utilities optimized for
CAD/computational design workflows.

---

## Features

- **Scene Initialization**: Pre-configured Three.js scene setup with scale-aware defaults for mm,
  cm, and m units
- **Mesh Handling**: Convert Rhino compute responses to Three.js meshes with automatic decompression
- **Material Library**: Pre-defined materials optimized for architectural and product visualization
- **Mesh Compression**: Efficient data compression for transferring geometry over the network
- **Camera & Controls**: Automatic camera positioning based on geometry bounding boxes
- **Responsive**: Built-in window resize handling and cleanup utilities

---

## Installation

This module is part of `@selvajs/compute`. Import from the `visualization` subpath:

```typescript
import {
	initThree,
	updateScene,
	getThreeMeshesFromComputeResponse
} from '@selvajs/compute/visualization';
```

---

## Quick Start

### Basic Setup

```typescript
import {
	initThree,
	updateScene,
	getThreeMeshesFromComputeResponse
} from '@selvajs/compute/visualization';
import { GrasshopperClient, TreeBuilder } from '@selvajs/compute';

// 1. Initialize Three.js scene
const canvas = document.querySelector('canvas');
const { scene, camera, controls, dispose } = initThree(canvas);

// 2. Run compute job
const client = await GrasshopperClient.create({ serverUrl: 'http://localhost:6500' });
const io = await client.getIO(definitionUrl);
const inputTree = TreeBuilder.fromInputParams(io.inputs);
const result = await client.solve(definitionUrl, inputTree);

// 3. Extract and display meshes (works only in combination with the Selva plugin
//    and the custom branch of rhino.compute)
const meshes = await getThreeMeshesFromComputeResponse(result);
updateScene(scene, meshes, camera, controls, false);

// 4. Cleanup when done
await client.dispose();
dispose();
```
