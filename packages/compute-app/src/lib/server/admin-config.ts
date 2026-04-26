// File-type constraints for the compute-app HTTP API layer.
// These are independent of whichever provider is configured.
//
// Size caps are centralized in `computeLimits.ts` — re-exported here so
// existing import sites keep working while there's only one place to change.
export {
	GH_EXTENSIONS,
	COVER_IMAGE_EXTENSIONS as IMAGE_EXTENSIONS,
	ALLOWED_UPLOAD_EXTENSIONS,
	COVER_IMAGE_CONTENT_TYPES as IMAGE_CONTENT_TYPES
} from '@selva/platform';

export { MAX_GH_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from './computeLimits';
