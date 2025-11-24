# Error Handling Analysis - ComputeBuilder Core Package

## Executive Summary

The error handling in the core package is **partially well-implemented** but shows **inconsistent patterns** that violate best practices. There are three main concerns:

1. **Inconsistent Error Types**: Generic `Error` and `RhinoComputeError` used interchangeably
2. **Lost Error Context**: Errors are caught and re-thrown without preserving original error chains
3. **Swallowed Errors**: Some catch blocks log errors but don't properly re-throw or handle them
4. **Inconsistent Validation**: Input validation throws generic errors instead of domain-specific errors

---

## Key Findings

### ✅ What's Working Well

#### 1. **Domain-Specific Error Class** (`RhinoComputeError`)

**Location**: `packages/core/src/core/errors/base.ts`

```typescript
export class RhinoComputeError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly context?: Record<string, unknown>;
}
```

**Strengths**:

- Extends native `Error` class ✓
- Includes error codes for categorization ✓
- Carries contextual information (statusCode, context object) ✓
- Proper TypeScript typing ✓

#### 2. **Centralized Error Mapping** (`compute-fetch.ts`)

**Location**: `packages/core/src/core/compute-fetch/compute-fetch.ts`

```typescript
const errorMap: Record<number, { message: string; code: string }> = {
  401: { message: ..., code: ErrorCodes.AUTH_ERROR },
  403: { message: ..., code: ErrorCodes.AUTH_ERROR },
  // ... more mappings
};
```

**Strengths**:

- HTTP status codes mapped to semantic error codes ✓
- Consistent error creation with contextual information ✓
- Centralized location makes maintenance easier ✓

#### 3. **Rich Error Context in Compute Operations**

**Location**: `packages/core/src/core/compute-fetch/compute-fetch.ts` (timeout handling)

```typescript
throw new RhinoComputeError(
  `Request timed out after ${config.timeoutMs}ms`,
  ErrorCodes.TIMEOUT_ERROR,
  {
    context: {
      serverUrl: config.serverUrl,
      timeoutMs: config.timeoutMs,
      url: fullUrl,
      requestId,
      args,
    },
  }
);
```

**Strengths**:

- Rich debugging context included ✓
- Includes original arguments for replay capability ✓
- Request ID for tracing ✓

---

### ❌ Critical Issues

#### Issue 1: **Inconsistent Error Types Throughout Codebase**

**Problem**: Mix of generic `Error` and `RhinoComputeError` being thrown

**Examples**:

**❌ Generic Error** in `mesh-compression.ts`:

```typescript
export function decompressMeshData(base64String: string): MeshData {
  try {
    const bytes = decodeBase64ToBinary(base64String);
    const decompressedData = fflate.gunzipSync(bytes);
    return parseMeshBinaryData(decompressedData);
  } catch (error) {
    console.error('Decompression failed:', error);
    throw new Error('Failed to decompress data'); // ❌ Generic error
  }
}

function parseMeshBinaryData(binaryMeshData: Uint8Array): MeshData {
  if (offset + 4 > dataView.byteLength) {
    throw new Error('Insufficient data to read the number of vertex floats.'); // ❌ Generic
  }
  // More throws...
}
```

**❌ Generic Error** in `grasshopper-client.ts`:

```typescript
if (!definitionUrl?.trim()) {
  throw new Error('Definition URL is required'); // ❌ Should be RhinoComputeError
}

if (!(await this.serverStats.isServerOnline())) {
  throw new Error('Rhino Compute server is not online'); // ❌ Should be RhinoComputeError
}
```

**❌ Generic Error** in `parser-utils.ts`:

```typescript
throw new Error(`Invalid boolean value: ${value}`); // ❌ Generic
```

**Impact**:

- Callers can't reliably handle errors by type
- Error codes are inconsistent across the codebase
- Difficult to implement retry logic for specific error types
- Makes API contracts unclear

---

#### Issue 2: **Lost Error Context (Error Chains)**

**Problem**: Original errors are caught but critical information is lost

**Example** in `compute-fetch.ts`:

```typescript
try {
  return await response.json();
} catch (error) {
  throw new RhinoComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
    statusCode: response.status,
    context: {
      originalError: (error as Error).message, // ❌ Only message preserved
      url: fullUrl,
      requestId,
    },
  });
}
```

**Problem**: Only `error.message` is captured. If the original error had a stack trace or was itself an error with properties, that's lost.

**Better approach** would be:

```typescript
catch (error) {
  throw new RhinoComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
    statusCode: response.status,
    context: {
      originalError: error instanceof Error ? error.stack : String(error),  // Preserve full context
      url: fullUrl,
      requestId,
    },
    cause: error,  // TypeScript 4.6+
  });
}
```

**Example** in `grasshopper-client.ts`:

```typescript
try {
  // ... operations
} catch (error) {
  if (this.config.debug) {
    console.error('Compute failed:', error); // ❌ Logs but error is still re-thrown
  }

  if (error instanceof RhinoComputeError) {
    throw error;
  }

  throw new RhinoComputeError(
    error instanceof Error ? error.message : String(error), // ❌ Message only
    undefined, // ❌ No error code!
    { context: { definitionUrl, inputs: dataTree } }
  );
}
```

**Issues here**:

1. No error code provided (undefined)
2. Only message is captured, not the full stack
3. Original error type is lost

---

#### Issue 3: **Swallowed Errors (Catch Without Proper Handling)**

**Problem**: Errors are caught and logged but not re-thrown properly

**Example** in `webdisplay-parser.ts`:

```typescript
try {
  // parsing logic
} catch (error) {
  // ❌ Error is caught but what happens next? Is it returned? Re-thrown?
}
```

**Example** in `input-processors.ts`:

```typescript
try {
  // ... processing
} catch {
  // ❌ Empty catch block - error is silently swallowed!
}
```

**Better approach**:

```typescript
try {
  // ...
} catch (error) {
  throw new RhinoComputeError(
    `Failed to process input: ${error instanceof Error ? error.message : String(error)}`,
    ErrorCodes.VALIDATION_ERROR,
    { context: { input: rawInput } }
  );
}
```

---

#### Issue 4: **Inconsistent Input Validation**

**Problem**: Validation errors throw generic `Error` instead of domain-specific errors

**Examples**:

```typescript
// ❌ In grasshopper-client.ts - validation throws generic Error
if (!config.serverUrl?.trim()) {
  throw new Error('serverUrl is required');
}

// ✅ In grasshopper-client.ts - disposal state throws RhinoComputeError
if (this.disposed) {
  throw new RhinoComputeError(
    'GrasshopperClient has been disposed and cannot be used',
    ErrorCodes.INVALID_STATE
  );
}
```

**Inconsistency**: Configuration validation throws generic errors, but state validation throws domain errors.

---

#### Issue 5: **Missing Error Codes in Some Branches**

**Example** in `grasshopper-client.ts`:

```typescript
throw new RhinoComputeError(
  error instanceof Error ? error.message : String(error),
  undefined, // ❌ No error code! Should be ErrorCodes.COMPUTATION_ERROR or similar
  { context: { definitionUrl, inputs: dataTree } }
);
```

**Impact**: Can't distinguish this error from others in error handling logic

---

### ⚠️ Best Practices Violations

| Principle                  | Current State                 | Should Be                                   |
| -------------------------- | ----------------------------- | ------------------------------------------- |
| **Consistent Error Types** | Mixed Error/RhinoComputeError | Always use RhinoComputeError in public APIs |
| **Error Codes**            | Some paths missing codes      | Every error should have a code              |
| **Error Chains**           | Lost with catch/re-throw      | Preserve with `cause` property              |
| **Input Validation**       | Generic errors                | Domain-specific errors (RhinoComputeError)  |
| **Unhandled Catches**      | Some empty/incomplete         | All catches should transform or re-throw    |
| **Context Preservation**   | Partial (message only)        | Full error + stack + original context       |
| **Error Documentation**    | Some @throws JSDoc            | All public functions should document errors |
| **Error Logging**          | Debug-only in some places     | Consistent logging strategy                 |

---

## Recommendations

### 1. **Standardize All Error Throws** (High Priority)

Convert all `throw new Error()` to `throw new RhinoComputeError()` with appropriate error codes.

**Example fix**:

```typescript
// Before
if (!definitionUrl?.trim()) {
  throw new Error('Definition URL is required');
}

// After
if (!definitionUrl?.trim()) {
  throw new RhinoComputeError('Definition URL is required', ErrorCodes.INVALID_INPUT, {
    context: { receivedUrl: definitionUrl },
  });
}
```

### 2. **Update RhinoComputeError to Support Error Chains** (Medium Priority)

Add support for the `cause` property introduced in TypeScript 4.6+:

```typescript
export class RhinoComputeError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly context?: Record<string, unknown>;
  public readonly originalError?: Error; // Add this

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    options?: {
      statusCode?: number;
      context?: Record<string, unknown>;
      originalError?: Error; // Add this
    }
  ) {
    super(message);
    this.name = 'RhinoComputeError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.context = options?.context;
    this.originalError = options?.originalError;

    // Set cause for better stack traces (Node.js 16.9+, TypeScript 4.6+)
    if ('cause' in Error.prototype) {
      Object.defineProperty(this, 'cause', {
        value: options?.originalError,
        enumerable: true,
      });
    }
  }
}
```

### 3. **Fix All Catch Blocks** (High Priority)

Ensure every catch block either:

- Re-throws with proper error transformation, OR
- Handles the error and doesn't re-throw, OR
- Logs and re-throws with context

**Example fix**:

```typescript
try {
  return await response.json();
} catch (error) {
  throw new RhinoComputeError('Failed to parse JSON response', ErrorCodes.NETWORK_ERROR, {
    statusCode: response.status,
    context: {
      url: fullUrl,
      requestId,
    },
    originalError: error instanceof Error ? error : new Error(String(error)),
  });
}
```

### 4. **Create Error Code for Configuration Errors** (Medium Priority)

Add a new error code for configuration/validation issues:

```typescript
export const ErrorCodes = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_ERROR: 'AUTH_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  COMPUTATION_ERROR: 'COMPUTATION_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  CORS_ERROR: 'CORS_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_CONFIG: 'INVALID_CONFIG', // Add this
} as const;
```

### 5. **Add Error Documentation** (Low Priority)

Ensure all public functions document their error behavior:

```typescript
/**
 * Run a compute job with a Grasshopper definition.
 *
 * @throws {RhinoComputeError} with code INVALID_INPUT if definitionUrl is empty
 * @throws {RhinoComputeError} with code NETWORK_ERROR if server is offline
 * @throws {RhinoComputeError} with code COMPUTATION_ERROR if computation fails
 */
public async solve(
  definitionUrl: string,
  dataTree: DataTree[]
): Promise<GrasshopperComputeResponse> {
  // ...
}
```

### 6. **Add Unit Tests for Error Scenarios** (Medium Priority)

Create tests that verify:

- Correct error codes are thrown
- Error context is preserved
- Error chains work correctly
- Validation errors are thrown for invalid inputs

---

## Summary Table

| File                          | Issues                                      | Severity | Fix                                               |
| ----------------------------- | ------------------------------------------- | -------- | ------------------------------------------------- |
| `mesh-compression.ts`         | Generic Error throws                        | High     | Replace with RhinoComputeError + VALIDATION_ERROR |
| `parser-utils.ts`             | Generic Error throws                        | High     | Replace with RhinoComputeError + VALIDATION_ERROR |
| `grasshopper-client.ts`       | Generic errors in validation, missing codes | High     | Standardize to RhinoComputeError with codes       |
| `compute-fetch.ts`            | Lost error context in catch                 | Medium   | Add originalError to context                      |
| `input-processors.ts`         | Silent catch blocks                         | High     | Add proper error transformation                   |
| `base.ts` (RhinoComputeError) | No error chain support                      | Medium   | Add originalError/cause property                  |
| `encoding.ts`                 | Generic Error throws                        | Medium   | Replace with RhinoComputeError                    |

---

## Implementation Priority

1. **Phase 1 (Critical)**: Standardize error types across entire core package
2. **Phase 2 (Important)**: Fix all catch blocks to preserve error context
3. **Phase 3 (Nice-to-have)**: Add error chain support to RhinoComputeError
4. **Phase 4 (Polish)**: Add comprehensive error documentation and tests
