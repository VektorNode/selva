/**
 * Debounce utility - delays function execution until after a specified wait time
 * has elapsed since the last time it was invoked.
 *
 * @param func The function to debounce
 * @param wait The delay in milliseconds
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>) {
    const context = this;

    if (timeout !== null) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func.apply(context, args);
      timeout = null;
    }, wait);
  };
}

/**
 * Throttle utility - ensures function is called at most once per specified time period.
 * Unlike debounce, this will execute the function immediately on the first call,
 * then ignore subsequent calls until the wait period has elapsed.
 *
 * @param func The function to throttle
 * @param wait The minimum time between executions in milliseconds
 * @returns A throttled version of the function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const context = this;

    if (now - lastCall >= wait) {
      // Enough time has passed, execute immediately
      lastCall = now;
      func.apply(context, args);
    } else {
      // Too soon, schedule for later (but only keep the latest call)
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => {
        lastCall = Date.now();
        func.apply(context, args);
        timeout = null;
      }, wait - (now - lastCall));
    }
  };
}
