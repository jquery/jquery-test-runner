import chalk from "chalk";
import { prettyMs } from "./lib/prettyMs.js";
import * as Diff from "diff";

function serializeForDiff( value ) {

	// Use naive serialization for everything except types with confusable values
	if ( typeof value === "string" ) {
		return JSON.stringify( value );
	}
	if ( typeof value === "bigint" ) {
		return `${ value }n`;
	}
	return `${ value }`;
}

export function reportTest( test, { fullBrowser, id } ) {
	if ( test.status === "passed" ) {

		// Write to console without newlines
		process.stdout.write( "." );
		return;
	}

	let message = `${ chalk.bold( `${ test.suiteName }: ${ test.name }` ) }`;
	message += `\nTest ${ test.status } on ${ chalk.yellow(
		fullBrowser
	) } (${ chalk.bold( id ) }).`;

	// test.assertions only contains passed assertions;
	// test.errors contains all failed asssertions
	if ( test.errors.length ) {
		for ( const error of test.errors ) {
			message += "\n";
			if ( error.message ) {
				message += `\n${ error.message }`;
			}
			message += `\n${ chalk.gray( error.stack ) }`;

			// Show expected and actual values
			// if either is defined and non-null.
			// error.actual is set to null for failed
			// assert.expect() assertions, so skip those as well.
			// This should be fine because error.expected would
			// have to also be null for this to be skipped.
			if ( error.expected != null || error.actual != null ) {
				message += `\nexpected: ${ chalk.red( JSON.stringify( error.expected ) ) }`;
				message += `\nactual: ${ chalk.green( JSON.stringify( error.actual ) ) }`;
				let diff;

				if ( Array.isArray( error.expected ) && Array.isArray( error.actual ) ) {

					// Diff arrays
					diff = Diff.diffArrays( error.expected, error.actual );
				} else if (
					typeof error.expected === "object" &&
					typeof error.actual === "object"
				) {

					// Diff objects
					diff = Diff.diffJson( error.expected, error.actual );
				} else if (
					typeof error.expected === "number" &&
					typeof error.actual === "number"
				) {

					// Diff numbers directly
					const value = error.actual - error.expected;
					if ( value > 0 ) {
						diff = [ { added: true, value: `+${ value }` } ];
					} else {
						diff = [ { removed: true, value: `${ value }` } ];
					}
				} else if (
					typeof error.expected === "string" &&
					typeof error.actual === "string"
				) {

					// Diff the characters of strings
					diff = Diff.diffChars( error.expected, error.actual );
				} else {

					// Diff everything else as words
					diff = Diff.diffWords(
						serializeForDiff( error.expected ),
						serializeForDiff( error.actual )
					);
				}

				if ( diff ) {
					message += "\n";
					message += diff
						.map( ( part ) => {
							if ( part.added ) {
								return chalk.green( part.value );
							}
							if ( part.removed ) {
								return chalk.red( part.value );
							}
							return chalk.gray( part.value );
						} )
						.join( "" );
				}
			}
		}
	}

	console.log( `\n\n${ message }` );

	// Only return failed messages
	if ( test.status === "failed" ) {
		return message;
	}
}

export function reportError( error ) {
	const title = `${ error.name || "Error" }: ${ error.message }`;
	let message = chalk.red( title );

	// Chromium error stacks include the title in the first line,
	// but Firefox error stacks do not.
	message += `\n${ chalk.gray( error.stack.replace( `${ title }\n`, "" ) ) }`;
	console.error( `\n\n${ message }` );
	return message;
}

export function reportEnd( result, { descriptiveUrl, fullBrowser, id } ) {
	console.log(
		`\n\nTests finished in ${ prettyMs( result.runtime ) } ` +
			`at ${ chalk.yellow( descriptiveUrl ) } ` +
			`in ${ chalk.yellow( fullBrowser ) } (${ chalk.bold( id ) })...`
	);
	console.log(
		( result.status !== "passed" ?
			`${ chalk.red( result.testCounts.failed ) } failed. ` :
			"" ) +
			`${ chalk.green( result.testCounts.total ) } passed. ` +
			`${ chalk.gray( result.testCounts.skipped ) } skipped.`
	);
	return result.testCounts;
}
