#!/usr/bin/env node

import yargs from "yargs/yargs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { browsers } from "../flags/browsers.js";
import { getPlan, listBrowsers, stopWorkers } from "../browserstack/api.js";
import { buildBrowserFromString } from "../browserstack/buildBrowserFromString.js";
import { run as runTests } from "../run.js";
import readYAML from "../lib/readYAML.js";
import { createTestServer } from "../createTestServer.js";

const DEFAULT_PORT = 3000;
const pkg = JSON.parse( await readFile( new URL( "../package.json", import.meta.url ) ) );

function parseFlags( flags ) {
	return Object.keys( flags ?? [] )
		.flatMap( ( key ) => flags[ key ]
		.map( ( value ) => `${ key }=${ value }` ) );
}

// Get all possible combinations of flag values.
// Example: { "jquery": [ "1.12.4", "3.5.1" ], "jquery-migrate": [ "dev", "min" ] }
// -> [ "jquery=1.12.4&jquery-migrate=dev", "jquery=3.5.1&jquery-migrate=dev",
//      "jquery=1.12.4&jquery-migrate=min", "jquery=3.5.1&jquery-migrate=min" ]
function parseRuns( runs ) {
	const results = [];

	function dfs( run, keys, startIndex ) {
		if ( startIndex === keys.length ) {
			if ( run.length > 0 ) {
				results.push( run.join( "&" ) );
			}
			return;
		}
		const key = keys[ startIndex ];
		const values = runs[ key ];
		for ( const value of values ) {
			dfs( run.concat( `${ key }=${ value }` ), keys, startIndex + 1 );
		}
	}

	dfs( [], Object.keys( runs ?? [] ), 0 );
	return results;
}

async function parseMiddleware( config, argv ) {
	const middleware = await Promise.all( [
		...( config.middleware ?? [] ),
		...( argv.middleware ?? [] )
	].map(
		async( mw ) => {
			const module = await import( resolve( process.cwd(), mw ) );
			return module.default;
		}
	) );
	return middleware;
}

yargs( process.argv.slice( 2 ) )
	.version( pkg.version )
	.command( {
		command: "run [options]",
		description: "Run unit tests in real browsers using selenium or BrowserStack.",
		builder: ( yargs ) => {
			yargs.option( "config-file", {
				alias: "c",
				type: "string",
				example: "jtr-config.yml",
				description: "Path to a YAML configuration file. " +
					"Use this to avoid passing options via the command line. " +
					"jquery-test-runner will automatically search for jtr.yml or jtr.yaml."
			} )
			.option( "base-url", {
				alias: "u",
				type: "string",
				example: "/tests/",
				description: "Base URL for the test server. " +
					"Expected to always start and end with a slash (/). " +
					"Defaults to \"/test/\"."
			} )
			.option( "test-url", {
				alias: "t",
				type: "array",
				description: "URLs to load the tests from. " +
					"Can be multiple, but defaults to the base URL."
			} )
			.option( "flag", {
				alias: "f",
				example: "module=core",
				type: "array",
				description: "Add a universal flag to be added as a query parameter " +
					"to the test URL for all test pages. e.g. --flag module=core"
			} )
			.option( "run", {
				type: "array",
				example: "module=core&esmodules=true",
				description: "Reuse the same tunnel and browser by adding more runs with " +
					"different flags. Each run is a separate test run. These have the same " +
					"format as the --flag option."
			} )
			.option( "browser", {
				alias: "b",
				type: "array",
				choices: browsers,
				description:
					"Run tests in a specific browser. " +
					"Pass multiple browsers by repeating the option. " +
					"If using BrowserStack, specify browsers using --browserstack. " +
					"Defaults to Chrome."
			} )
			.option( "middleware", {
				alias: "m",
				type: "array",
				description: "Add middleware to the test server by passing " +
					"the path to a module that exports a middleware factory function. " +
					"Pass multiple by repeating the option."
			} )
			.option( "headless", {
				alias: "h",
				type: "boolean",
				description:
					"Run tests in headless mode. Cannot be used with --debug or --browserstack.",
				conflicts: [ "debug", "browserstack" ]
			} )
			.option( "concurrency", {
				type: "number",
				description:
					"Run tests in parallel in multiple browsers. " +
					"Defaults to 8 in normal mode. In browserstack mode, " +
					"defaults to the maximum available under your BrowserStack plan."
			} )
			.option( "debug", {
				alias: "d",
				type: "boolean",
				description:
					"Leave the browser open for debugging. Cannot be used with --headless.",
				conflicts: [ "headless" ]
			} )
			.option( "retries", {
				alias: "r",
				type: "number",
				description: "Number of times to retry failed tests by refreshing the URL."
			} )
			.option( "hard-retries", {
				type: "number",
				description:
					"Number of times to retry failed tests by restarting the worker. " +
					"This is in addition to the normal retries " +
					"and are only used when the normal retries are exhausted."
			} )
			.option( "verbose", {
				alias: "v",
				type: "boolean",
				description: "Log additional information, including all test server requests."
			} )
			.option( "browserstack", {
				type: "array",
				description:
					"Run tests in BrowserStack.\n" +
					"Requires BROWSERSTACK_USERNAME and " +
					"BROWSERSTACK_ACCESS_KEY environment variables.\n" +
					"The value can be empty for the default configuration, " +
					"or a string in the format of\n" +
					"\"browser_[browserVersion | :device]_os_osVersion\" (see --list-browsers).\n" +
					"Pass multiple browsers by repeating the option.\n" +
					"The --browser option is ignored when --browserstack has a value.\n" +
					"Otherwise, the --browser option will be used, " +
					"with the latest version/device for that browser, on a matching OS."
			} )
			.option( "run-id", {
				type: "string",
				description: "A unique identifier for the run in BrowserStack."
			} );
		},
		handler: async( { configFile, ...argv } ) => {
			const config = await readYAML( configFile );
			const flag = [
				...parseFlags( config.flags ),
				...( config.flag ?? [] ),
				...( argv.flag ?? [] )
			];
			const run = [
				...parseRuns( config.runs ),
				...( config.run ?? [] ),
				...( argv.run ?? [] )
			];
			const middleware = await parseMiddleware( config, argv );

			return runTests( {
				...config,
				testUrl: config.testUrls,
				...argv,
				flag,
				middleware,
				run
			} );
		}
	} )
	.command( {
		command: "serve [options]",
		description: "Run a simple server for loading tests in a browser.",
		builder: ( yargs ) => {
			yargs.option( "config-file", {
				alias: "c",
				type: "string",
				description: "Path to a YAML configuration file. " +
					"Use this to avoid passing options via the command line."
			} )
			.option( "base-url", {
				alias: "u",
				type: "string",
				description: "Base URL for the test server. " +
					"Expected to always start and end with a slash (/). " +
					"Defaults to \"/test/\"."
			} )
			.option( "port", {
				alias: "p",
				type: "number",
				description: "Port to listen on. Defaults to 3000."
			} )
			.option( "quiet", {
				alias: "q",
				type: "boolean",
				description: "Whether to log requests to the console. Default: false."
			} )
			.option( "middleware", {
				alias: "m",
				type: "array",
				description: "Add middleware to the test server by passing " +
					"the path to a module that exports a middleware factory function. " +
					"Pass multiple by repeating the option."
			} );
		},
		handler: async( { configFile, quiet, ...argv } ) => {
			console.log( "Starting server..." );
			const config = await readYAML( configFile );
			const middleware = await parseMiddleware( config, argv );
			const baseUrl = config.baseUrl ?? argv.baseUrl ?? "/test/";

			/**
			 * Run a simple server for loading tests in a browser.
			 * Note: this server does not support middleware.
			 * To add middleware, use createTestServer directly.
			 */
			const app = await createTestServer( { baseUrl, middleware, quiet } );

			const port = argv.port ?? config.port ?? DEFAULT_PORT;
			return app.listen( { port, host: "0.0.0.0" }, function() {
				console.log( `Open tests at http://localhost:${ port }${ baseUrl }` );
			} );
		}
	} )
	.command( {
		command: "list-browsers [filter]",
		description:
			"List available BrowserStack browsers and exit.\n" +
			"Leave blank to view all browsers or pass " +
			"\"browser_[browserVersion | :device]_os_osVersion\" with each parameter " +
			"separated by an underscore to filter the list (any can be omitted).\n" +
			"\"latest\" can be used in place of \"browserVersion\" to find the latest version.\n" +
			"\"latest-n\" can be used to find the nth latest browser version.\n" +
			"Use a colon to indicate a device.\n" +
			"Examples: \"chrome__windows_10\", \"safari_latest\", " +
			"\"Mobile Safari\", \"Android Browser_:Google Pixel 8 Pro\".\n" +
			"Use quotes if spaces are necessary.",
		builder: ( yargs ) => {
			yargs.positional( "filter", {
				type: "string",
				description: "Filter the list of browsers."
			} );
		},
		handler: ( { filter } ) => {
			return listBrowsers( buildBrowserFromString( filter ) );
		}
	} )
	.command( {
		command: "stop-workers",
		description:
			"WARNING: This will stop all BrowserStack workers that may exist and exit," +
			"including any workers running from other projects.\n" +
			"This can be used as a failsafe when there are too many stray workers.",
		handler: () => {
			console.log( "Stopping workers..." );
			stopWorkers();
		}
	} )
	.command( {
		command: "browserstack-plan",
		description: "Show BrowserStack plan information and exit.",
		handler: async() => {
			console.log( await getPlan() );
		}
	} )
	.help()
	.parse();
