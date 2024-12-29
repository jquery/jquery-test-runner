import { generateModuleId } from "./generateHash.js";

export function buildTestUrl( {
	baseUrl,
	browserstack,
	flags,
	isolatedFlag,
	jsdom,
	port,
	reportId,
	testUrl = ""
} ) {
	if ( !port ) {
		throw new Error( "No port specified." );
	}

	const query = new URLSearchParams();
	const allFlags = [ ...flags, ...( isolatedFlag ? [ isolatedFlag ] : [] ) ];
	for ( const flag of allFlags ) {
		const [ key, value ] = flag.split( "=" );

		// Special handling for the module flag
		if ( key === "module" ) {
			query.append( "moduleId", generateModuleId( value ) );
		} else {
			query.append( key, value ?? "true" );
		}
	}

	if ( jsdom ) {
		query.append( "jsdom", "true" );
	}

	if ( reportId ) {
		query.append( "reportId", reportId );
	}

	// BrowserStack supplies a custom domain for local testing,
	// which is especially necessary for iOS testing.
	const host = browserstack ? "bs-local.com" : "localhost";
	return `http://${ host }:${ port }${ baseUrl }${ testUrl }?${ query }`;
}
