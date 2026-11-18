import type { OutboundMessage } from '@selvajs/platform/notifications';
import type { InviteMailInput } from './templates/invite.js';
import type { ApiTokenCreatedMailInput } from './templates/api-token.js';

export type MailRenderer<Input> = (input: Input) => OutboundMessage | Promise<OutboundMessage>;

/**
 * Host replacements for the built-in templates, one per mail kind. A host that
 * sells the engine under its own name or language renders its own wording here;
 * a kind left out uses the built-in English template.
 *
 * Return the same `kind` the built-in would: the dispatcher routes on it.
 */
export interface MailTemplates {
	invite?: MailRenderer<InviteMailInput>;
	apiTokenCreated?: MailRenderer<ApiTokenCreatedMailInput>;
}
