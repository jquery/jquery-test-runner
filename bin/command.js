#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { browsers } from "../flags/browsers.js";
import { getPlan, listBrowsers, stopWorkers } from "../browserstack/api.js";
import { buildBrowserFromString } from "../browserstack/buildBrowserFromString.js";
import { run as runTests } from "../run.js";
import readYAML from "../lib/readYAML.js";
import { createTestServer } from "../createTestServer.js";
import { pathToFileURL } from "node:url";

const program = new Command();
const DEFAULT_PORT = 3000;
const pkg = JSON.parse(
	await readFile( new URL( "../package.json", import.meta.url ) )
);

program.name( pkg.name ).version( pkg.version );

// Define the run command
program
	.command( "run", { isDefault: true } )
	.description(
		"Run unit tests in real browsers using selenium or BrowserStack."
	)
	.option(
		"-c, --config-file <path>",
		"Path to a YAML configuration file. " +
			"Use this to avoid passing options via the command line. " +
			"jquery-test-runner will automatically search for jtr.yml or jtr.yaml."
	)
	.option(
		"-u, --base-url <url>",
		"Base URL for the test server. " +
			"Expected to always start and end with a slash (/). Defaults to \"/test/\"."
	)
	.option(
		"-t, --test-url <urls...>",
		"URLs to load the tests from. Can be multiple, but defaults to the base URL."
	)
	.option(
		"-f, --flag <flags...>",
		"Add a universal flag to be added as a query parameter " +
			"to the test URL for all test pages. e.g. --flag module=core"
	)
	.option(
		"--run <runs...>",
		"Reuse the same tunnel and browser by adding more runs with different flags. " +
			"Each run is a separate test run. These have the same format as the --flag option."
	)
	.option(
		"-b, --browser <browsers...>",
		"Run tests in a specific browser. Pass multiple browsers by repeating the option. " +
			"If using BrowserStack, specify browsers using --browserstack. " +
			"Choices: " + browsers.join( ", " ) +
			". Defaults to Chrome."
	)
	.option(
		"-m, --middleware <middlewares...>",
		"Add middleware to the test server by passing the path to a module that exports " +
			"a middleware factory function. Pass multiple by repeating the option."
	)
	.option(
		"--headless",
		"Run tests in headless mode. Cannot be used with --debug or --browserstack."
	)
	.option(
		"--concurrency <number>",
		"Run tests in parallel in multiple browsers. Defaults to 8 in normal mode. " +
			"In browserstack mode, defaults to the maximum available under your BrowserStack plan.",
		parseInt
	)
	.option(
		"-d, --debug",
		"Leave the browser open for debugging. Cannot be used with --headless."
	)
	.option(
		"-r, --retries <number>",
		"Number of times to retry failed tests by refreshing the URL.",
		parseInt
	)
	.option(
		"--hard-retries <number>",
		"Number of times to retry failed tests by restarting the worker. " +
			"This is in addition to the normal retries and are only used " +
			"when the normal retries are exhausted.",
		parseInt
	)
	.option(
		"-v, --verbose",
		"Log additional information."
	)
	.option(
		"--browserstack <configs...>",
		"Run tests in BrowserStack. Requires BROWSERSTACK_USERNAME and " +
			"BROWSERSTACK_ACCESS_KEY environment variables. " +
			"The value can be empty for the default configuration, " +
			"or a string in the format of \"browser_[browserVersion | :device]_os_osVersion\" " +
			"(see --list-browsers). Pass multiple browsers by repeating the option. " +
			"The --browser option is ignored when --browserstack has a value. " +
			"Otherwise, the --browser option will be used, with the latest version/device " +
			"for that browser, on a matching OS."
	)
	.option( "--run-id <id>", "A unique identifier for the run in BrowserStack." )
	.action( async( { configFile, ...argv } ) => {
		const config = await readYAML( configFile );
		const options = {
			baseUrl: "/test/",
			...config,
			testUrl: config.testUrls,
			...argv
		};
		options.flag = [
			...parseFlags( config.flags ),
			...( options.flag ?? [] )
		];
		options.run = [
			...parseRuns( config.runs ),
			...( options.run ?? [] )
		];
		options.middleware = await parseMiddleware( options );

		return runTests( options );
	} );

// Define the serve command
program
	.command( "serve" )
	.description( "Run a simple server for loading tests in a browser." )
	.option(
		"-c, --config-file <path>",
		"Path to a YAML configuration file. " +
			"Use this to avoid passing options via the command line."
	)
	.option(
		"-u, --base-url <url>",
		"Base URL for the test server. " +
			"Expected to always start and end with a slash (/). Defaults to \"/test/\"."
	)
	.option(
		"-p, --port <number>",
		"Port to listen on. Defaults to 3000."
	)
	.option(
		"-q, --quiet",
		"Whether to log requests to the console. Default: false."
	)
	.option(
		"-m, --middleware <middlewares...>",
		"Add middleware to the test server by " +
			"passing the path to a module that exports a middleware factory function. " +
			"Pass multiple by repeating the option."
	)
	.action( async( { configFile, ...argv } ) => {
		console.log( "Starting server..." );
		const config = await readYAML( configFile );
		const options = {
			baseUrl: "/test/",
			port: DEFAULT_PORT,
			...config,
			...argv
		};
		options.middleware = await parseMiddleware( options );

		/**
		 * Run a simple server for loading tests in a browser.
		 * Note: this server does not support middleware.
		 * To add middleware, use createTestServer directly.
		 */
		const app = await createTestServer( options );

		return app.listen( { port: options.port, host: "0.0.0.0" }, function() {
			console.log( `Open tests at http://localhost:${ options.port }${ options.baseUrl }` );
		} );
	} );

// Define the list-browsers command
program
	.command( "list-browsers <filter>" )
	.description(
		"List available BrowserStack browsers and exit.\n" +
			"Leave blank to view all browsers or pass " +
			"\"browser_[browserVersion | :device]_os_osVersion\" with each parameter " +
			"separated by an underscore to filter the list (any can be omitted).\n" +
			"\"latest\" can be used in place of \"browserVersion\" to find the latest version.\n" +
			"\"latest-n\" can be used to find the nth latest browser version.\n" +
			"Use a colon to indicate a device.\n" +
			"Examples: \"chrome__windows_10\", \"safari_latest\", " +
			"\"Mobile Safari\", \"Android Browser_:Google Pixel 8 Pro\".\n" +
			"Use quotes if spaces are necessary."
	)
	.action( ( filter ) => {
		console.log( "Listing browsers with filter:", filter );
		return listBrowsers( buildBrowserFromString( filter ) );
	} );

// Define the stop-workers command
program
	.command( "stop-workers" )
	.description(
		"WARNING: This will stop all BrowserStack workers that may exist and exit," +
			"including any workers running from other projects.\n" +
			"This can be used as a failsafe when there are too many stray workers."
	)
	.action( () => {
		console.log( "Stopping workers..." );
		stopWorkers();
	} );

// Define the browserstack-plan command
program
	.command( "browserstack-plan" )
	.description( "Show BrowserStack plan information and exit." )
	.action( async() => {
		console.log( await getPlan() );
	} );

program.parse( process.argv );

function parseFlags( flags ) {
	return Object.keys( flags ?? [] ).flatMap( ( key ) =>
		flags[ key ].map( ( value ) => `${ key }=${ value }` )
	);
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

async function parseMiddleware( options ) {
	const middleware = await Promise.all(
		( options.middleware ?? [] ).map(
			async( mw ) => {
				const filepath = pathToFileURL( resolve( process.cwd(), mw ) ).toString();
				if ( options.verbose ) {
					console.log( `Loading middleware from ${ filepath }...` );
				}
				const module = await import( filepath );
				return module.default;
			}
		)
	);
	return middleware;
}
