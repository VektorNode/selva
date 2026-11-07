import { z } from 'zod';

export const PlatformProjectGranteeTypeSchema = z.enum(['org', 'user']);
