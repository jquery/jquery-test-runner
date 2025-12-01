import chalk from "chalk";
import { asyncExitHook, gracefulExit } from "exit-hook";
import { getLatestBrowser } from "./browserstack/api.js";
import { buildBrowserFromString } from "./browserstack/buildBrowserFromString.js";
import { localTunnel } from "./browserstack/local.js";
import { reportEnd, reportError, reportTest } from "./reporter.js";
import { createTestServer } from "./createTestServer.js";
import { buildTestUrl } from "./lib/buildTestUrl.js";
import { generateHash, generateModuleId } from "./lib/generateHash.js";
import { getBrowserString } from "./lib/getBrowserString.js";
import { cleanupAllBrowsers, touchBrowser } from "./browsers.js";
import {
	addRun,
	getNextBrowserTest,
	hardRetryTest,
	retryTest,
	runAll
} from "./queue.js";

const EXIT_HOOK_WAIT_TIMEOUT = 60 * 1000;
const rendsWithSlash = /\/$/;

export async function run( {
	baseUrl = "/test/",
	browser: browserNames = [],
	browserstack,
	concurrency,
	debug,
	flag: flags = [],
	flagHook = defaultFlagHook,
	hardRetries,
	headless,
	middleware = [],
	retries = 0,
	run: runs = [],
	runId,
	safariTp,
	testUrl: testUrls = [],
	verbose
} ) {
	if ( !browserNames.length ) {
		browserNames = [ "chrome" ];
	}
	if ( headless && debug ) {
		throw new Error(
			"Cannot run in headless mode and debug mode at the same time."
		);
	}
	if ( safariTp && browserstack ) {
		throw new Error(
			"Cannot use --safari-tp with --browserstack."
		);
	}

	// Ensure baseUrl ends with a slash
	if ( !rendsWithSlash.test( baseUrl ) ) {
		baseUrl += "/";
	}

	if ( verbose ) {
		console.log( browserstack ? "Running in BrowserStack." : "Running locally." );
	}

	const errorMessages = [];
	const pendingErrors = {};

	// Convert browser names to browser objects
	let browsers = browserNames.map( ( b ) => ( { browser: b } ) );
	const hashValue = flags
		.concat( browserstack || [] )
		.concat( browserNames )
		.join( ":" );
	const tunnelId = generateHash( `${ Date.now() }-${ hashValue }` );

	// A unique identifier for this run
	if ( !runId ) {
		runId = tunnelId;
	}

	// Create the test app and
	// hook it up to the reporter
	const reports = Object.create( null );
	const app = await createTestServer( {
		baseUrl,
		middleware,
		quiet: true, // Quiet server logs during test runs
		testUrls,
		report: async( message ) => {
			const reportId = message.id;
			const report = reports[ reportId ];

			switch ( message.type ) {
				case "ack":
					touchBrowser( report.browser );
					break;
				case "testEnd": {
					touchBrowser( report.browser );
					const errorMessage = reportTest( message.data, report );
					pendingErrors[ reportId ] ??= Object.create( null );
					if ( errorMessage ) {
						pendingErrors[ reportId ][ message.data.name ] = errorMessage;
					} else {
						const existing = pendingErrors[ reportId ][ message.data.name ];

						// Show a message for flakey tests
						if ( existing ) {
							console.log();
							console.warn(
								chalk.italic(
									chalk.gray( existing.replace( "Test failed", "Test flakey" ) )
								)
							);
							console.log();
							delete pendingErrors[ reportId ][ message.data.name ];
						}
					}
					break;
				}
				case "error": {
					touchBrowser( report.browser );
					const errorMessage = reportError( message.data );
					pendingErrors[ reportId ] ??= Object.create( null );
					pendingErrors[ reportId ][ message.data.message ] = errorMessage;
					break;
				}
				case "runEnd": {
					touchBrowser( report.browser );
					const { failed, total } = reportEnd( message.data, reports[ reportId ] );
					report.total = total;

					// Handle failure
					if ( failed ) {
						const retry = retryTest( reportId, retries );

						// Retry if retryTest returns a test
						if ( retry ) {
							return retry;
						}

						// Return early if hardRetryTest returns true
						if ( await hardRetryTest( reportId, hardRetries ) ) {
							return;
						}
						errorMessages.push( ...Object.values( pendingErrors[ reportId ] ) );
						if ( !errorMessages.length ) {
							errorMessages.push( `Global failure in ${ report.url }` );
						}
					}

					// Run the next test
					return getNextBrowserTest( reportId );
				}
				default:
					console.warn( "Received unknown message type:", message.type );
			}
		}
	} );

	// Start up local test server
	let server;
	let port;
	await new Promise( ( resolve ) => {

		// Pass 0 to choose a random, unused port
		server = app.listen( 0, () => {
			port = server.address().port;
			resolve();
		} );
	} );

	if ( !server || !port ) {
		throw new Error( "Server not started." );
	}

	if ( verbose ) {
		console.log( `Server started on port ${ port }.` );
	}

	function stopServer() {
		return new Promise( ( resolve ) => {
			server.close( () => {
				if ( verbose ) {
					console.log( "Server stopped." );
				}
				resolve();
			} );
		} );
	}

	async function cleanup() {
		console.log( "Cleaning up..." );

		await cleanupAllBrowsers( { verbose } );

		if ( tunnel ) {
			await tunnel.stop();
			if ( verbose ) {
				console.log( "Stopped BrowserStackLocal." );
			}
		}
	}

	asyncExitHook(
		async( signal ) => {
			await cleanup();
			await stopServer();

			if ( verbose ) {
				console.log( `Exited with signal: ${ signal }` );
			}
		},
		{ wait: EXIT_HOOK_WAIT_TIMEOUT }
	);

	// Start up BrowserStackLocal
	let tunnel;
	if ( browserstack ) {
		if ( headless ) {
			console.warn(
				chalk.italic(
					"BrowserStack does not support headless mode. Running in normal mode."
				)
			);
			headless = false;
		}

		// Convert browserstack to browser objects.
		// If browserstack is an empty array, fall back
		// to the browsers array.
		if ( browserstack.length ) {
			browsers = browserstack.map( ( b ) => {
				if ( !b ) {
					return browsers[ 0 ];
				}
				return buildBrowserFromString( b );
			} );
		}

		// Fill out browser defaults
		browsers = await Promise.all(
			browsers.map( async( browser ) => {

				// Avoid undici connect timeout errors
				await new Promise( ( resolve ) => setTimeout( resolve, 100 ) );

				const latestMatch = await getLatestBrowser( browser );
				if ( !latestMatch ) {
					console.error(
						chalk.red( `Browser not found: ${ getBrowserString( browser ) }.` )
					);
					gracefulExit( 1 );
				}
				return latestMatch;
			} )
		);

		tunnel = await localTunnel( tunnelId );
		if ( verbose ) {
			console.log( "Started BrowserStackLocal." );
		}
	}

	function queueRun( browser, { run, testUrl } = {} ) {
		const fullBrowser = getBrowserString( browser, { headless, safariTp } );
		const reportId = generateHash(
			`${ hashValue }-${ run }-${ testUrl }-${ fullBrowser }`
		);

		const urlOptions = {
			baseUrl,
			browserstack,
			flags,
			run,
			jsdom: browser.browser === "jsdom",
			port,
			testUrl
		};

		const descriptiveUrl = buildTestUrl( urlOptions );
		const url = buildTestUrl( {
			...urlOptions,
			flagHook,
			reportId
		} );

		const options = {
			baseUrl,
			browserstack,
			runId,
			concurrency,
			debug,
			flags,
			headless,
			run,
			reportId,
			safariTp,
			testUrl,
			tunnelId,
			verbose
		};

		const report = {
			browser,
			descriptiveUrl,
			flags,
			fullBrowser,
			headless,
			id: reportId,
			run,
			testUrl,
			url
		};

		reports[ reportId ] = report;

		addRun( url, browser, options );
	}

	for ( const browser of browsers ) {
		if ( runs.length > 0 ) {
			runs.forEach( ( run ) => {
				if ( testUrls.length > 0 ) {
					testUrls.forEach( ( testUrl ) => {
						queueRun( browser, { run, testUrl } );
					} );
				} else {
					queueRun( browser, { run } );
				}
			} );
		} else if ( testUrls.length > 0 ) {
			testUrls.forEach( ( testUrl ) => {
				queueRun( browser, { testUrl } );
			} );
		} else {
			queueRun( browser );
		}
	}

	try {
		console.log( `Starting test run ${ runId }...` );
		await runAll();
	} catch ( error ) {
		console.error( error );
		if ( !debug ) {
			gracefulExit( 1 );
		}
	} finally {
		console.log();
		const numErrors = errorMessages.length;
		if ( numErrors === 0 ) {
			let stop = false;
			for ( const report of Object.values( reports ) ) {
				if ( !report.total ) {
					stop = true;
					console.error(
						chalk.red(
							`No tests were run with URL "${ report.url }" ` +
								`in ${ report.fullBrowser } (${ report.id })`
						)
					);
				}
			}
			if ( stop ) {
				gracefulExit( 1 );
				return;
			}
			console.log( chalk.green( "All tests passed!" ) );

			if ( !debug || browserstack ) {
				gracefulExit();
			}
		} else {
			console.error(
				chalk.red( `${ numErrors } test${ numErrors > 1 ? "s" : "" } failed.` )
			);
			console.log(
				errorMessages.map( ( error, i ) => `\n${ i + 1 }. ${ error }` ).join( "\n" )
			);

			if ( debug ) {
				console.log();
				if ( browserstack ) {
					console.log( "Leaving browsers with failures open for debugging." );
					console.log(
						"View running sessions at https://automate.browserstack.com/dashboard/v2/"
					);
				} else {
					console.log( "Leaving browsers open for debugging." );
				}
				console.log( "Press Ctrl+C to exit." );
			} else {
				gracefulExit( 1 );
			}
		}
	}
}

function defaultFlagHook( key, value ) {

	// Convert module flag to module ID
	if ( key === "module" ) {
		return [ "moduleId", generateModuleId( value ) ];
	}
	return [ key, value ];
}
