// Its own module: the hook needs the path on every request, and importing it from `server.ts`
// would load the MCP SDK and the OpenAPI builder at boot.
export const MCP_PATH = '/mcp';

/** Download links for a solve's output files. The token in the path is the credential. */
export const MCP_FILES_PREFIX = '/mcp/files/';
