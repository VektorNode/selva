---
'@selvajs/mcp': minor
'@selvajs/server': minor
'@selvajs/selva': minor
---

New `@selvajs/mcp`: serve a host's `/api/v1` as MCP tools over stdio or streamable HTTP, with key auth, error mapping, 429 handling and annotations from the spec.

`@selvajs/server/api` exports `buildOpenApiDocument(endpoints, options)` and the `Endpoint` type, so every host publishes the same spec shape. `Endpoint.scope` is required and emitted as `x-scope`.

Selva serves `GET /api/v1/openapi.json` and an MCP endpoint at `/mcp`: send an API key as `Authorization: Bearer <key>`. Tools: `selva_list_projects`, `selva_list_definitions`, `selva_describe_definition`, `selva_solve`.
