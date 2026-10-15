# @selvajs/mcp

## 0.1.0-beta.1

### Minor Changes

- 80a7ed1: **Breaking:** `handle(request)` answers as the request's own `Authorization: Bearer` key and never the configured `apiKey`, which only `listen` and `verify` use; a request without a key gets 401 with `WWW-Authenticate: Bearer`. Before, every HTTP caller ran as the server's key. `apiKey` is now optional: a host serving only HTTP drops it, and can stop parsing the bearer itself.
- 80a7ed1: A tool can return pictures: `ToolOutput.images` (`{ data, mimeType }`, base64) go out as MCP image content after the text, for a model that can see. Clients render PNG, JPEG, GIF and WebP, not SVG.

## 0.1.0-beta.0

### Minor Changes

- 075919c: New `@selvajs/mcp`: serve a host's `/api/v1` as MCP tools over stdio or streamable HTTP, with key auth, error mapping, 429 handling and annotations from the spec.

  `@selvajs/server/api` exports `buildOpenApiDocument(endpoints, options)` and the `Endpoint` type, so every host publishes the same spec shape. `Endpoint.scope` is required and emitted as `x-scope`.

  Selva serves `GET /api/v1/openapi.json` and an MCP endpoint at `/mcp`: send an API key as `Authorization: Bearer <key>`. Tools: `selva_list_projects`, `selva_list_definitions`, `selva_describe_definition`, `selva_solve`.
