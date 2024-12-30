// Read a yaml configuration file using the `readYAML` function.
// The path is expected to either be absolute or relative to the current working directory.

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

const CONFIG_VERSION = 1;
const rkebab = /-([a-z])/g;

export default async function readYAML( path ) {
	if ( !path ) {
		if ( await stat( resolve( process.cwd(), "jtr.yml" ) ).catch( () => false ) ) {
			path = "jtr.yml";
		} else if ( await stat( resolve( process.cwd(), "jtr.yaml" ) ).catch( () => false ) ) {
			path = "jtr.yaml";
		} else {
			return {};
		}
	}

	const contents = await readFile( resolve( process.cwd(), path ), "utf8" );
	let config = await parse( contents );

	if ( config.version !== CONFIG_VERSION ) {
		throw new Error( `Invalid configuration version. Expected ${ CONFIG_VERSION }.` );
	}

	// Convert kebab-case keys to camelCase
	config = Object.fromEntries(
		Object.entries( config ).map( ( [ key, value ] ) => [
			key.replace( rkebab, ( _, letter ) => letter.toUpperCase() ),
			value
		] )
	);

	return config;
}
