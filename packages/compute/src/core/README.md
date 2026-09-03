# Core module

Backend-agnostic plumbing for talking to a Rhino Compute server: HTTP transport, error types,
server URL validation, and base64/field-read utilities.

## Structure

```text
src/core/
├── compute-fetch/    # Low-level HTTP client logic
├── errors.ts         # Custom error types and factory
├── files/            # File-output helpers
├── server/           # Server URL validation
├── utils/            # Encoding, logging, field reads
├── definition-ref.ts # Definition reference resolution
└── types.ts          # Core shared configuration types
```

## Usage

### 1. Low-level API requests

Use `fetchCompute` for type-safe requests to arbitrary Rhino Compute endpoints.

```typescript
import { fetchCompute, ComputeError } from '@selvajs/compute/core';

async function performCustomJob(config) {
	try {
		const response = await fetchCompute('rhino/geometry/point/at', { x: 1, y: 0, z: 0 }, config);
		return response;
	} catch (error) {
		if (error instanceof ComputeError) {
			// Handle specific error codes (e.g. AUTH_ERROR, COMPUTATION_ERROR)
			console.error(`[${error.code}] ${error.message} (HTTP ${error.statusCode ?? 'n/a'})`);
		}
	}
}
```

### 2. Definition forms

A solve takes bytes directly, or a `DefinitionRef`: a stable key plus a lazy
`load()`, so a caller that already knows a definition's identity (e.g. a stored
version's UUID) can schedule solves without materializing multi-MB bytes.

```typescript
import { isDefinitionRef, type SolveDefinition } from '@selvajs/compute/core';
```

Read `DefinitionRef`'s immutability contract before constructing one: two
different byte contents sharing a key poisons every cache built on it.

### 3. Backend configuration

`core/` knows nothing about Rhino. See [`CONTEXT.md`](../../CONTEXT.md#core-concepts) for the three
seams a backend uses to plug in (`apiKeyHeader`, `serverErrorCodes`, `validateServerUrl`), and why
`ComputeServerStats` ships from `@selvajs/compute/grasshopper` instead of here.

`GrasshopperClient` and other higher-level features use these modules internally; use them directly
for custom low-level calls or your own monitoring.
