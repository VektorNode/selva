/**
 * Compute throttle utility for managing async compute requests.
 *
 * Features:
 * - Only one request in-flight at a time
 * - Latest values always sent (no queue, just "latest wins")
 * - AbortController support to cancel stale requests
 * - Configurable timeout with automatic abort
 *
 * Flow:
 * 1. User changes value → request sent immediately
 * 2. User changes value while request in-flight → current request aborted, new one starts
 * 3. Result: server never overwhelmed, always processing latest values
 */
export interface ComputeThrottleOptions {
    /** Timeout in milliseconds. Default: 60000 (60 seconds) */
    timeout?: number;
}
export declare function createComputeThrottle<T>(computeFn: (values: T, signal: AbortSignal) => Promise<void>, options?: ComputeThrottleOptions): {
    /** Trigger a compute with the given values */
    trigger: (values: T) => void;
    /** Whether a compute is currently in progress */
    readonly isComputing: boolean;
    /** Whether there are pending values waiting to be sent */
    readonly hasPending: boolean;
    /** Cancel any in-flight request */
    cancel: () => void;
};
