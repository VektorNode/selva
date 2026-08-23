/**
 * Kinds of message Selva sends. One kind is one reason-to-be-messaged, not one
 * template and not one transport: a kind may render differently per channel and
 * a user opts in or out per kind.
 *
 * The string is persisted in user preferences, so renaming one silently resets
 * that preference for everyone who set it. Add rather than rename.
 */
export type NotificationKind = 'org.invite' | 'auth.magic-link';

/**
 * One message, rendered and addressed, ready for a transport.
 *
 * `text` and `html` are both required: a mail with no text part is a
 * deliverability problem, and clients that strip HTML must still receive the
 * link. Transports that have no notion of HTML send `text`.
 */
export interface OutboundMessage {
	kind: NotificationKind;
	to: string;
	subject: string;
	text: string;
	html: string;
}

/**
 * Outcome of a send attempt.
 *
 * `not-configured` is distinct from `failed` on purpose — an instance with no
 * mail server is a supported deployment, not a broken one, and callers surface
 * the two differently (the invite route falls back to "copy this link by hand"
 * for the first and reports a problem for the second).
 */
export type SendResult =
	{ status: 'sent' } | { status: 'not-configured' } | { status: 'failed'; reason: string };
