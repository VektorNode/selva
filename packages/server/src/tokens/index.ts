// HMAC token codec for capability-URL tokens (share links, invites, …).

export {
	createTokenCodec,
	MIN_TOKEN_SECRET_LENGTH,
	type TokenCodec,
	type TokenCodecConfig
} from './token-codec.js';
