# Core Module

Foundational utilities and low-level clients that power the `@selvajs/compute` library. This module handles the "plumbing" of communicating with Rhino Compute.

## Key Responsibilities

- **Compute Communication**: Type-safe HTTP wrappers for the Rhino Compute API.
- **Error Handling**: Specialized `RhinoComputeError` classes for precise debugging of API and network failures.
- **Server Monitoring**: Utilities to fetch runtime stats and telemetry from Compute instances.
- **Data Processing**: Utilities for base64 encoding/decoding and camelCase normalization of API responses.

## Structure

```text
src/core/
├── compute-fetch/    # Low-level HTTP client logic
├── errors/           # Custom error types and factory
├── server/           # Server health and stats monitoring
├── utils/            # Encoding, logging, and string utilities
└── types.ts          # Core shared configuration types
```

## Usage

The `core` module provides the building blocks for the rest of the library. Below are the two most common ways to use it.

### 1. Low-level API Requests

Use `fetchRhinoCompute` for type-safe requests to arbitrary Rhino Compute endpoints.

```typescript
import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';

async function performCustomJob(config) {
	try {
		const response = await fetchRhinoCompute(
			'rhino/geometry/point/at',
			{ x: 1, y: 0, z: 0 },
			config
		);
		return response;
	} catch (error) {
		if (error instanceof RhinoComputeError) {
			// Handle specific error codes (e.g. AUTH_ERROR, COMPUTATION_ERROR)
			console.error(`[${error.code}] ${error.message} (HTTP ${error.statusCode ?? 'n/a'})`);
		}
	}
}
```

### 2. Definition forms

A solve takes bytes directly, or a `DefinitionRef` — a stable key plus a lazy
`load()`, so a caller that already knows a definition's identity (e.g. a stored
version's UUID) can schedule solves without materializing multi-MB bytes.

```typescript
import { isDefinitionRef, type SolveDefinition } from '@selvajs/compute/core';
```

Read `DefinitionRef`'s immutability contract before constructing one: two
different byte contents sharing a key poisons every cache built on it.

### 3. Backend configuration

`core/` knows nothing about Rhino. Three knobs carry what a backend needs:

- `ComputeConfig.apiKeyHeader` — header name for `apiKey` (default `RhinoComputeKey`)
- `ComputeConfig.serverErrorCodes` — this backend's wire codes → our `ErrorCodes`
- `validateServerUrl(url, { blockedHosts })` — the shared public endpoint to reject

`ComputeServerStats` used to live here. It probes rhino.compute's control plane
(`/activechildren`, `/plugins/gh/installed`, `/idlespan`), so it now ships from
`@selvajs/compute/grasshopper`.

> **Note:** Higher-level features like the `GrasshopperClient` use these modules internally. Direct use is recommended for custom low-level API calls or dedicated monitoring services.
