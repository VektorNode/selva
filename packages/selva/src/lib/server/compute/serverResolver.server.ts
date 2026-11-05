/**
 * The process's remembered server resolutions: solves and describes read it, and both compute
 * config writers (`/api/admin/compute`, the org handler through `onComputeConfigSaved`) clear it.
 */
import { createServerResolver } from '@selvajs/server/compute';

export const serverResolver = createServerResolver();
