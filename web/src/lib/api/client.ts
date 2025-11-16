import type { UISchema, RuntimeValues, SessionState, AvailableParameters } from '$lib/types/schema';

/**
 * API client for initial data fetching (WebSocket-only version)
 * All real-time updates happen via WebSocket - this is only for initial page loads
 */
export class ApiClient {
	private baseUrl: string;

	constructor(baseUrl = '/api') {
		this.baseUrl = baseUrl;
	}

	/**
	 * Get schema for a session (initial load only)
	 */
	async getSchema(sessionId: string): Promise<UISchema | null> {
		const response = await fetch(`${this.baseUrl}/schema/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}

	/**
	 * Save schema for a session
	 */
	async saveSchema(sessionId: string, schema: UISchema): Promise<boolean> {
		console.log('Saving schema', schema);
		const response = await fetch(`${this.baseUrl}/schema/${sessionId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(schema)
		});
		return response.ok;
	}

	/**
	 * Get runtime values for a session (initial load only)
	 */
	async getValues(sessionId: string): Promise<RuntimeValues | null> {
		const response = await fetch(`${this.baseUrl}/values/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}

	/**
	 * Get session state (initial load only)
	 */
	async getState(sessionId: string): Promise<SessionState | null> {
		const response = await fetch(`${this.baseUrl}/state/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}

	/**
	 * Get available parameters for a session (initial load only)
	 */
	async getAvailableParameters(sessionId: string): Promise<AvailableParameters | null> {
		const response = await fetch(`${this.baseUrl}/available/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}
}

export const api = new ApiClient();
