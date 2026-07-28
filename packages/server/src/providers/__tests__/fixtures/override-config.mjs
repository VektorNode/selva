// Fixture for the SELVA_CONFIG_PATH override test — a minimal selva.config.js
// whose default export is a config factory, exactly as an operator would write.
export default (env) => ({
	tenancy: 'multi',
	auth: { name: 'override-auth' },
	data: { marker: env.OVERRIDE_MARKER },
	storage: {}
});
