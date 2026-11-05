// Opened per request in hooks.server.ts; GET and HEAD only (see `createRequestMemo`).
import { createRequestMemo } from '@selvajs/server/http';

export const requestMemo = createRequestMemo();
