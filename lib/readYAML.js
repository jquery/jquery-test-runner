// Read a yaml configuration file using the `readYAML` function.
// The path is expected to either be absolute or relative to the current working directory.

import { readFile, stat } from "node:fs/promises";
import { parse } from "yaml";
import { resolve } from "node:path";

export const CONFIG_VERSION = 1;
export const DEFAULT_YAML_PATHS = [ "jtr.yml", "jtr.yaml" ];

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

	if ( !path.endsWith( ".yml" ) && !path.endsWith( ".yaml" ) ) {
		throw new Error( "Invalid configuration file. Expected a YAML file." );
	}

	let contents;

	// Check if path is absolute
	if ( path.startsWith( "/" ) || path.startsWith( "\\" ) || path.includes( ":" ) ) {
		if ( !await stat( path ).catch( () => false ) ) {
			throw new Error( `Configuration file not found: ${ path }` );
		}

		contents = await readFile( path, "utf8" );
	} else {
		path = resolve( process.cwd(), path );

		if ( !await stat( path ).catch( () => false ) ) {
			throw new Error( `Configuration file not found: ${ path }` );
		}

		contents = await readFile( path, "utf8" );
	}
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
