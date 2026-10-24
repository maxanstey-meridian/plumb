// the formatter keeps code to the line width but it never wraps a comment, so this one is
// wrapped by hand
// https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text/and/goes/on
export const answer = 42;

export const x = 1; // a comment after code is out of scope: MER-TO-015 only measures comment-only lines, never mixed ones
export const y = 2; /* a block comment opening after code is out of scope on that line: only comment-only lines are measured
   while its short middle line is measured
*/
