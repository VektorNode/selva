/**
 * Overridable UI strings for the parameter-preset manager (Save/Load flow) and
 * footer copyright text. All optional — unset keys fall back to the English
 * defaults in `DEFAULT_PRESET_LABELS`. Pass a partial object to localize.
 */
export interface PresetLabels {
	// Toolbar buttons
	saveButton: string;
	loadButton: string;

	// Save dialog
	saveDialogTitle: string;
	saveDialogDescription: string;
	saveNameLabel: string;
	saveNamePlaceholder: string;
	saveDescriptionLabel: string;
	saveDescriptionPlaceholder: string;
	saveAuthorLabel: string;
	saveAuthorPlaceholder: string;
	saveTagsLabel: string;
	saveTagsPlaceholder: string;
	saveNameRequired: string;

	// Load dialog
	loadDialogTitle: string;
	loadDialogDescription: string;
	loadFromFileButton: string;
	loadEmptyList: string;
	loadImportError: string;

	// Validation dialog
	validationTitle: string;
	validationValidatingPrefix: string;
	validationNoIssuesTitle: string;
	validationNoIssuesBody: string;
	validationWarningsTitle: string;
	/** `{count}` is replaced with the number of warnings. */
	validationWarningsBody: string;
	validationErrorsTitle: string;
	validationErrorsBody: string;
	validationIssuesHeading: string;
	validationExpected: string;
	validationActual: string;

	// Shared buttons
	cancelButton: string;
	loadAnywayButton: string;
}

export const DEFAULT_PRESET_LABELS: PresetLabels = {
	saveButton: 'Save State',
	loadButton: 'Load State',

	saveDialogTitle: 'Save Parameter State',
	saveDialogDescription: 'Save the current parameter values as a .slvp file',
	saveNameLabel: 'State Name *',
	saveNamePlaceholder: 'e.g., Design Option A',
	saveDescriptionLabel: 'Description',
	saveDescriptionPlaceholder: 'Optional description of this state',
	saveAuthorLabel: 'Author',
	saveAuthorPlaceholder: 'Your name or email',
	saveTagsLabel: 'Tags',
	saveTagsPlaceholder: 'facade, option-a, client-approved (comma-separated)',
	saveNameRequired: 'Please enter a name for this state',

	loadDialogTitle: 'Load Parameter State',
	loadDialogDescription: 'Select a .slvp state file from your drive to load',
	loadFromFileButton: 'Select .slvp File',
	loadEmptyList: 'No saved states found',
	loadImportError: 'Failed to import state: ',

	validationTitle: 'State Validation Report',
	validationValidatingPrefix: 'Validating state: ',
	validationNoIssuesTitle: 'No Issues Found',
	validationNoIssuesBody: 'This state can be loaded safely.',
	validationWarningsTitle: 'Warnings Detected',
	validationWarningsBody: '{count} warning(s) found, but state can still be loaded.',
	validationErrorsTitle: 'Critical Errors',
	validationErrorsBody: 'Cannot load this state due to critical incompatibilities.',
	validationIssuesHeading: 'Issues:',
	validationExpected: 'Expected:',
	validationActual: 'Actual:',

	cancelButton: 'Cancel',
	loadAnywayButton: 'Load Anyway'
};
