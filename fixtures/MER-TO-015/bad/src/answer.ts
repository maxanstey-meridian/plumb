// the formatter keeps code to the line width but it never wraps a comment, so this one runs on well past it
export const answer = 42;

/**
 * a doc comment's continuation line is a comment line too, and the formatter leaves this one far too wide
 */
export const continued = 1;

/** a one-line doc comment is still a comment the formatter won't wrap, so this one runs past the width */
export const oneLine = 2;

// https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text has prose after it
export const linked = 3;

export const late = 4; /* a block comment that starts after code still has comment-only middle lines,
   and this middle one runs on past the line width of the file, so it is checked like any other comment-only line
*/
