// App routes stay framable (embedding is what Selva-engine apps are for), but the operator
// surfaces hold an authenticated admin session, where a framable page is a UI-redress attack.
const FRAME_DENIED_PREFIXES = ['/admin', '/setup', '/login', '/oauth'];

/**
 * Whether a response to `pathname` must refuse framing. Kit routes on the decoded path, so
 * `/%61dmin` renders /admin: this matches what Kit matches, and a path that does not decode is
 * refused too.
 */
export function deniesFraming(pathname: string): boolean {
	let path: string;
	try {
		path = pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return true;
	}
	return FRAME_DENIED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
