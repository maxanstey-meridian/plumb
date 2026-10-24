// the formatter keeps code to the line width but it never wraps a comment, so this one is
// wrapped by hand
// https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text/and/goes/on
export const answer = 42;

export const x = 1; // a comment after code shares the code's line, which the formatter owns, so plumb never measures it
export const y = 2; /* a block comment opening after code shares that code line too, which the formatter owns, so it isn't measured
   while its short middle line is measured
*/
