// Moved to `@selvajs/visualization/session`, where the Solve Session that hydrates from it
// now lives. Re-exported here to keep the published `@selvajs/ui/external` sub-path — and
// the pre-step producer routes that import it — working unchanged.

export {
	writeExternalValue,
	readExternalValue,
	clearExternalValue,
	getExternalInputs,
	type ExternalValueRef,
	type ExternalInput
} from '@selvajs/visualization/session';
