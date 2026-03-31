// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			details?: string;
		}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	const __GIT_HASH__: string;
	const __GIT_SHORT_HASH__: string;
	const __GIT_MESSAGE__: string;
	const __GIT_DATE__: string;
}

export {};
