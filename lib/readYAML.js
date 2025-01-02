// Read a yaml configuration file using the `readYAML` function.
// The path is expected to either be absolute or relative to the current working directory.

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

const CONFIG_VERSION = 1;
const DEFAULT_YAML_PATHS = [ "jtr.yml", "jtr.yaml" ];

const rkebab = /-([a-z])/g;

export default async function readYAML( path ) {
	if ( !path ) {
		for ( const defaultPath of DEFAULT_YAML_PATHS ) {
			if ( await stat( resolve( process.cwd(), defaultPath ) ).catch( () => false ) ) {
				path = defaultPath;
			}
		}
	}
	if ( !path ) {
		return {};
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
