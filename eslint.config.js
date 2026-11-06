import globals from "globals";

const zotero = {
	Zotero: "readonly", Services: "readonly", Cc: "readonly", Ci: "readonly", Cu: "readonly",
	Components: "readonly", ChromeUtils: "readonly", IOUtils: "readonly", PathUtils: "readonly",
	Localization: "readonly", MozXULElement: "readonly", Zotero_Tabs: "readonly", ZoteroPane: "readonly",
	XPCOMUtils: "readonly", cloneInto: "readonly", exportFunction: "readonly", Hafif: "writable",
	HafifPrefs: "writable", HafifPrefsAI: "writable", pref: "readonly", ChromeWorker: "readonly",
};

export default [
	{ ignores: ["**/lib/**", "**/dist/**", "node_modules/**"] },
	{
		files: ["zotero-hafif/**/*.js", "zotero-hafif/**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "script",
			globals: { ...globals.browser, ...zotero },
		},
		rules: {
			"no-undef": "error",
			"no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
			"no-dupe-keys": "error",
			"no-unreachable": "error",
			"no-cond-assign": ["error", "except-parens"],
			"no-redeclare": ["error", { builtinGlobals: false }],
			"no-self-assign": "error",
			"no-empty": ["warn", { allowEmptyCatch: true }],
			"no-useless-escape": "off",
			"no-control-regex": "off",
			"no-misleading-character-class": "off",
		},
	},
	{ files: ["zotero-hafif/**/*.mjs", "zotero-hafif/content/windows/*.js"], languageOptions: { sourceType: "module" } },
	{ files: ["zotero-hafif/content/windows/*.js"], languageOptions: { sourceType: "script" } },
	{ files: ["zotero-hafif/prefs.js"], rules: { "no-undef": "off" } },
	{ files: ["zotero-hafif/bootstrap.js"], rules: { "no-unused-vars": "off" } },
	{ files: ["scripts/**", "tests/**", "eslint.config.js"], languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node } },
];
