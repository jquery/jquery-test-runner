// Read a yaml configuration file using the `readYAML` function.
// The path is expected to either be absolute or relative to the current working directory.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

const CONFIG_VERSION = 1;

export default async function readYAML( path ) {
	if ( !path ) {
		return {};
	}

	const contents = await readFile( resolve( process.cwd(), path ), "utf8" );
	const config = await parse( contents );

	if ( config.version !== CONFIG_VERSION ) {
		throw new Error( `Invalid configuration version. Expected ${ CONFIG_VERSION }.` );
	}
	return config;
}
