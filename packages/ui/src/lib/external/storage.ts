// Moved to @selvajs/solve/client, beside the Solve Session that hydrates from it.
// Re-exported to keep the published `@selvajs/ui/external` sub-path working unchanged.

export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs,
	type ExternalValueRef,
	type ExternalInput
} from '@selvajs/solve/client';
