import { Builder, Capabilities, logging } from "selenium-webdriver";
import Chrome from "selenium-webdriver/chrome.js";
import Edge from "selenium-webdriver/edge.js";
import Firefox from "selenium-webdriver/firefox.js";
import IE from "selenium-webdriver/ie.js";
import { browserSupportsHeadless } from "../lib/getBrowserString.js";

// Set script timeout to 10min
const DRIVER_SCRIPT_TIMEOUT = 1000 * 60 * 10;

export default async function createDriver( { browserName, headless, url, verbose } ) {
	const capabilities = Capabilities[ browserName ]();

	// Support: IE 11+
	// When those are set for IE, the process crashes with an error:
	// "Unable to match capability set 0: goog:loggingPrefs is an unknown
	// extension capability for IE".
	if ( browserName !== "ie" ) {
		const prefs = new logging.Preferences();
		prefs.setLevel( logging.Type.BROWSER, logging.Level.ALL );
		capabilities.setLoggingPrefs( prefs );
	}

	const chromeOptions = new Chrome.Options();
	chromeOptions.addArguments( "--enable-chrome-browser-cloud-management" );

	// Alter the chrome binary path if
	// the CHROME_BIN environment variable is set
	if ( process.env.CHROME_BIN ) {
		if ( verbose ) {
			console.log( `Setting chrome binary to ${ process.env.CHROME_BIN }` );
		}
		chromeOptions.setChromeBinaryPath( process.env.CHROME_BIN );
	}

	const firefoxOptions = new Firefox.Options();

	if ( process.env.FIREFOX_BIN ) {
		if ( verbose ) {
			console.log( `Setting firefox binary to ${ process.env.FIREFOX_BIN }` );
		}

		firefoxOptions.setBinary( process.env.FIREFOX_BIN );
	}

	const edgeOptions = new Edge.Options();
	edgeOptions.addArguments( "--enable-chrome-browser-cloud-management" );

	// Alter the edge binary path if
	// the EDGE_BIN environment variable is set
	if ( process.env.EDGE_BIN ) {
		if ( verbose ) {
			console.log( `Setting edge binary to ${ process.env.EDGE_BIN }` );
		}
		edgeOptions.setEdgeChromiumBinaryPath( process.env.EDGE_BIN );
	}

	const ieOptions = new IE.Options();
	ieOptions.setEdgeChromium( true );
	ieOptions.setEdgePath( "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" );

	// Set IEDriver path from environment variable or GitHub Actions default
	let ieService;
	let ieDriverPath = process.env.IEWEBDRIVER;
	if ( !ieDriverPath && process.env.GITHUB_ACTIONS ) {

		// The default in GitHub Actions Windows runners
		ieDriverPath = "C:\\SeleniumWebDrivers\\IEDriver";
	}

	if ( ieDriverPath ) {

		// Append the executable name if only a directory was provided
		if ( !ieDriverPath.endsWith( ".exe" ) ) {
			ieDriverPath = `${ ieDriverPath }\\IEDriverServer.exe`;
		}
		if ( verbose ) {
			console.log( `Setting IEDriver path to ${ ieDriverPath }` );
		}
		ieService = new IE.ServiceBuilder( ieDriverPath );
	}

	if ( headless ) {
		chromeOptions.addArguments( "--headless=new" );
		firefoxOptions.addArguments( "--headless" );
		edgeOptions.addArguments( "--headless=new" );
		if ( !browserSupportsHeadless( browserName ) ) {
			console.log(
				`Headless mode is not supported for ${ browserName }.` +
					"Running in normal mode instead."
			);
		}
	}

	const builder = new Builder().withCapabilities( capabilities )
		.setChromeOptions( chromeOptions )
		.setFirefoxOptions( firefoxOptions )
		.setEdgeOptions( edgeOptions )
		.setIeOptions( ieOptions );

	if ( ieService ) {
		builder.setIeService( ieService );
	}

	const driver = builder.build();

	if ( verbose ) {
		const driverCapabilities = await driver.getCapabilities();
		const name = driverCapabilities.getBrowserName();
		const version = driverCapabilities.getBrowserVersion();
		console.log( `\nDriver created for ${ name } ${ version }` );
	}

	// Increase script timeout to 10min
	await driver.manage().setTimeouts( { script: DRIVER_SCRIPT_TIMEOUT } );

	// Set the first URL for the browser,
	// but don't wait for the page to load
	// so the worker is set up in time
	// for the ack request.
	driver.get( url );

	return driver;
}
