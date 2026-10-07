// HMAC token codec for capability-URL tokens (share links, invites, …).

export {
	createTokenCodec,
	MIN_TOKEN_SECRET_LENGTH,
	type TokenCodec,
	type TokenCodecConfig
} from './token-codec.js';

// API tokens (`selva_`): the same HMAC-at-rest scheme, plus a checksum.
export {
	createApiTokenCodec,
	API_TOKEN_PREFIX,
	looksLikeApiToken,
	type ApiTokenCodec
} from './api-token-codec.js';
