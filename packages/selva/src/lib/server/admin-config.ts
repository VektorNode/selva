// File-type constraints for the selva app HTTP API layer, independent of
// whichever provider is configured. Size caps live in `computeLimits.ts` and
// are re-exported here so there's one place to change them.
export {
	GH_EXTENSIONS,
	COVER_IMAGE_EXTENSIONS as IMAGE_EXTENSIONS,
	ALLOWED_UPLOAD_EXTENSIONS,
	COVER_IMAGE_CONTENT_TYPES as IMAGE_CONTENT_TYPES
} from '@selvajs/platform';

export { MAX_DEFINITION_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from './computeLimits';
