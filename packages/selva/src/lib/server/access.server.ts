/**
 * The app's access guards: the framework-free ones re-exported from
 * `@selvajs/server/access`, plus the redirecting ones that only make sense here.
 *
 * A redirect is a browser-page outcome, and SvelteKit implements it by throwing
 * a value only SvelteKit recognizes — so these three cannot move into the
 * package without dragging the framework in with them. Every other guard did
 * move, and the handlers that call them no longer name SvelteKit at all.
 *
 * Guards raise `ApiError` now rather than SvelteKit's `error()`. API routes get
 * that folded into the envelope by `mapAppError`; **page loads must wrap the
 * call in {@link asHttpError}**. SvelteKit derives a response status by checking
 * `error instanceof HttpError` and returns 500 for everything else, and
 * `handleError` runs too late to change it — so an unwrapped guard renders the
 * right message under the wrong status, which looks like a crash rather than a
 * denial and never trips a test that only asserts on the message.
 */

import { error, redirect } from '@sveltejs/kit';
import { ALL_PLATFORM_PERMISSIONS, hasPermission, type AuthUser } from '@selvajs/platform';
import { isApiError } from '@selvajs/server/api';
import { requireAuthed, type AnyPermission, type Locals } from '@selvajs/server/access';

export * from '@selvajs/server/access';

/**
 * Run a guard outside `mount`, converting its `ApiError` into the `HttpError`
 * SvelteKit needs to produce a real status. Needed by page loads and by API
 * routes that build their own `Response` instead of going through `mount`,
 * since those never reach `mapAppError`.
 */
export async function asHttpError<T>(run: () => T | Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (isApiError(err)) {
			throw error(err.status, { message: err.message, code: err.code, fields: err.fields });
		}
		throw err;
	}
}

export function assertPagePermission(locals: Locals, permission: AnyPermission): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	if (!hasPermission(ctx, permission)) {
		redirect(303, '/admin');
	}
	return user;
}

export const assertManageInstanceUsers = (locals: Locals) =>
	assertPagePermission(locals, 'manage_instance_users');
export const assertManageCompute = (locals: Locals) =>
	assertPagePermission(locals, 'manage_compute');

/**
 * Gate for pages reachable by any platform-class permission holder (the
 * `/admin` shell — `instance_admin`, `manage_compute`, `manage_instance_users`,
 * or `manage_updates` all qualify). Org-scope permissions never admit entry:
 * org admins do not belong on platform-scoped surfaces.
 */
export function assertAnyPlatformPermission(locals: Locals): AuthUser {
	const { user, ctx } = requireAuthed(locals);
	const allowed = ALL_PLATFORM_PERMISSIONS.some((p) => hasPermission(ctx, p));
	if (!allowed) redirect(303, '/library');
	return user;
}
