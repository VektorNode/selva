// Moved to `@selvajs/server/definitions`. This shim keeps the app-internal
// import path stable; new code may import from the package directly.
export {
	fetchSchemaFromCompute,
	assertSupportedSchemaVersion,
	SchemaExtractionError
} from '@selvajs/server/definitions';
