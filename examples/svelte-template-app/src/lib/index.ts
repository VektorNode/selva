import type { GrasshopperComputeResponse } from "@selva/core";

export interface ProcessedMessage {
  component: string;
  count: number;
  sample: string;
  errorCode?: string;
}

export interface ProcessedMessages {
  errors: ProcessedMessage[];
  warnings: ProcessedMessage[];
  summary: {
    totalErrors: number;
    totalWarnings: number;
    uniqueComponents: number;
  };
}

/**
 * Extracts component name and error type from Grasshopper error message.
 *
 * @example
 * "Solution exception:The calling thread must be STA...: component "SynapseLabel" (776ef2fe-af14-4e88-b9b4-087734b2fe74)"
 * → { component: "SynapseLabel", errorType: "STA threading" }
 *
 * "likely a bad format string input, try something like "2,3": component "SnpTableLayout""
 * → { component: "SnpTableLayout", errorType: "bad format string" }
 */
function parseErrorMessage(message: string): {
  component: string;
  errorType: string;
} {
  // Extract component name from pattern: component "ComponentName" (uuid)
  const componentMatch = message.match(/component\s+"([^"]+)"/);
  const component = componentMatch ? componentMatch[1] : 'Unknown';

  // Classify error type
  let errorType = 'Other';

  if (message.includes('calling thread must be STA')) {
    errorType = 'STA threading';
  } else if (message.includes('bad format string')) {
    errorType = 'Bad format string';
  } else if (message.includes('Solution exception')) {
    errorType = 'Solution exception';
  } else if (message.includes('likely')) {
    errorType = 'Invalid input';
  }

  return { component, errorType };
}

/**
 * Groups messages by component and error type, deduplicating common errors.
 * Helps identify which components are actually failing vs. flooding with duplicates.
 *
 * @param messages - Array of error or warning messages
 * @returns Grouped and summarized messages, sorted by frequency
 */
function groupMessagesByComponent(messages: string[]): ProcessedMessage[] {
  const grouped = new Map<
    string,
    { count: number; sample: string; errorType: string }
  >();

  for (const message of messages) {
    const { component, errorType } = parseErrorMessage(message);
    const key = `${component}::${errorType}`;
    const existing = grouped.get(key) || {
      count: 0,
      sample: message,
      errorType,
    };

    grouped.set(key, {
      count: existing.count + 1,
      sample: existing.sample,
      errorType,
    });
  }

  return Array.from(grouped.entries())
    .map(([, { count, sample, errorType }]) => {
      const { component } = parseErrorMessage(sample);
      return {
        component: `${component} (${errorType})`,
        count,
        sample,
        errorCode: errorType,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * Processes Grasshopper compute response and summarizes messages by component.
 * Deduplicates repetitive errors to surface actual problems.
 *
 * @param result - Compute response from server
 * @returns Processed messages grouped by component with counts and summary stats
 *
 * @example
 * ```typescript
 * const response = await solveGrasshopperDefinition(config, inputs);
 * const processed = processComputeMessages(response);
 *
 * // Output:
 * // {
 * //   errors: [
 * //     { component: "SynapseLabel (STA threading)", count: 156, sample: "..." },
 * //     { component: "SnpTableLayout (Bad format string)", count: 2, sample: "..." }
 * //   ],
 * //   summary: { totalErrors: 158, totalWarnings: 0, uniqueComponents: 2 }
 * // }
 * ```
 */
export function processComputeMessages(
  result: GrasshopperComputeResponse,
): ProcessedMessages {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];

  const processedErrors = groupMessagesByComponent(errors);
  const processedWarnings = groupMessagesByComponent(warnings);

  return {
    errors: processedErrors,
    warnings: processedWarnings,
    summary: {
      totalErrors: errors.length,
      totalWarnings: warnings.length,
      uniqueComponents: processedErrors.length + processedWarnings.length,
    },
  };
}
