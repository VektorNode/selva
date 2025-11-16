import type { UISchema, RuntimeValues, SessionState, AvailableParameters } from '$lib/types/schema';

/**
 * API client for communicating with the backend (file-based or HTTP)
 */
export class ApiClient {
	private baseUrl: string;

	constructor(baseUrl = '/api') {
		this.baseUrl = baseUrl;
	}

	/**
	 * Get schema for a session
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
	 * Get runtime values for a session
	 */
	async getValues(sessionId: string): Promise<RuntimeValues | null> {
		const response = await fetch(`${this.baseUrl}/values/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}

	/**
	 * Update runtime values for a session
	 */
	async updateValues(sessionId: string, values: Record<string, any>): Promise<boolean> {
		const response = await fetch(`${this.baseUrl}/values/${sessionId}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ timestamp: new Date().toISOString(), values })
		});
		return response.ok;
	}

	/**
	 * Get session state
	 */
	async getState(sessionId: string): Promise<SessionState | null> {
		const response = await fetch(`${this.baseUrl}/state/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}

	/**
	 * Get available parameters for a session
	 */
	async getAvailableParameters(sessionId: string): Promise<AvailableParameters | null> {
		const response = await fetch(`${this.baseUrl}/available/${sessionId}`);
		if (!response.ok) return null;
		return response.json();
	}

	/**
	 * Poll for value updates (used in preview mode)
	 */
	async pollValues(sessionId: string, callback: (values: RuntimeValues) => void, interval = 500) {
		let lastTimestamp = '';

		const poll = async () => {
			const values = await this.getValues(sessionId);
			if (values && values.timestamp !== lastTimestamp) {
				lastTimestamp = values.timestamp;
				callback(values);
			}
		};

		const intervalId = setInterval(poll, interval);
		return () => clearInterval(intervalId);
	}
}

export const api = new ApiClient();
