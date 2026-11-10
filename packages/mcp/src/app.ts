import type { ResourceDefinition } from './server.js';

/** The MIME type a client renders as an MCP App view rather than reading as text. */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Who may call a tool that has a view. `model` lists it for the agent; `app` lets its view call
 * it. A client hides a tool without `model` from the agent, so an `['app']` tool can return
 * what only the view needs (geometry, a page of rows) without it reaching the model.
 */
export type ToolVisibility = 'model' | 'app';

export interface ToolUi {
	/** The `ui://` resource the client renders beside this tool's result. */
	resourceUri: string;
	/** Default `['model', 'app']`. */
	visibility?: ToolVisibility[];
}

/**
 * Origins the view may reach. The client's default allows none: no `fetch`, no script, style or
 * image from anywhere but the page itself and `data:` URLs.
 */
export interface AppCsp {
	/** `fetch`, XHR and WebSocket targets. */
	connectDomains?: string[];
	/** Scripts, styles, images, fonts and media. */
	resourceDomains?: string[];
	/** Nested iframes. */
	frameDomains?: string[];
	baseUriDomains?: string[];
}

export interface AppResourceOptions {
	uri: `ui://${string}`;
	name: string;
	description?: string;
	/** One self-contained HTML document: scripts and styles inline, or from `csp.resourceDomains`. */
	html: () => string | Promise<string>;
	csp?: AppCsp;
	/** Leave unset to let the client choose. */
	prefersBorder?: boolean;
}

/** A view for tools to name in `ui.resourceUri`. It reads no `/api/v1`; its tools do. */
export function appResource(options: AppResourceOptions): ResourceDefinition {
	const { uri, name, description, html, csp, prefersBorder } = options;
	const ui = {
		...(csp && { csp }),
		...(prefersBorder !== undefined && { prefersBorder })
	};
	return {
		uri,
		name,
		description,
		mimeType: MCP_APP_MIME_TYPE,
		...(Object.keys(ui).length > 0 && { meta: { ui } }),
		calls: [],
		read: async () => html()
	};
}

/** Where a solve view reads its data in a tool result's `_meta`. */
export const SOLVE_VIEW_KEY = 'selva/solve-view';

/**
 * What a tool hands a solve view under {@link SOLVE_VIEW_KEY}: the geometry itself, or an
 * `['app']` tool the view calls for it. A solve's meshes run to megabytes, so `load` keeps them
 * out of the first result; that tool answers with `{ response }` under the same key.
 */
export interface SolveViewData {
	title?: string;
	/** A Rhino.Compute response, or only its display trees (`values`, `modelunits`). */
	response?: unknown;
	load?: { tool: string; arguments?: Record<string, unknown> };
}
