export function buildTestUrl( {
	baseUrl,
	browserstack,
	flags,
	flagHook,
	run,
	jsdom,
	port,
	reportId,
	testUrl = ""
} ) {
	if ( !port ) {
		throw new Error( "No port specified." );
	}

	const query = new URLSearchParams();
	const allFlags = [ ...flags, ...( run ? run.split( "&" ) : [] ) ];
	for ( const flag of allFlags ) {
		const [ key, value ] = flag.split( "=" );

		// Allow for custom flag handling
		if ( flagHook ) {
			query.append.apply( query, flagHook( key, value ) );
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
	return `http://${ host }:${ port }${ baseUrl }${ testUrl }${
		query.size > 0 ? `?${ query }` : ""
	}`;
}
