import jqueryConfig from "eslint-config-jquery";
import globals from "globals";

export default [
	{
		ignores: [
			"test/jquery",
			"test/jquery-migrate",
			"test/jquery-ui"
		]
	},
	{
		files: [
			"**/*.js"
		],
		languageOptions: {
			ecmaVersion: "latest",
			globals: {
				...globals.node
			}
		},
		rules: {
			...jqueryConfig.rules,
			"no-unused-vars": [
				"error",
				{
					args: "after-used",
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_"
				}
			]
		}
	},
	{
		files: [ "listeners.js" ],
		languageOptions: {
			ecmaVersion: 5,
			sourceType: "script",
			globals: {
				...globals.browser,
				QUnit: false,
				Symbol: false
			}
		}
	}
];
