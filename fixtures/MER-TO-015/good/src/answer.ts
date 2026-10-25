// the formatter keeps code to the line width but it never wraps a comment, so this one is
// wrapped by hand
// https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text/and/goes/on
export const answer = 42;

export const x = 1; // a comment after code is out of scope: MER-TO-015 only measures comment-only lines, never mixed ones
export const y = 2; /* a block comment opening after code is out of scope on that line: only comment-only lines are measured
   while its short middle line is measured
*/
export const owned = "a code line the formatter owns: it keeps code to its width, so plumb never measures code lines, however long";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a lint directive is read from its one line, so its reason can't wrap
export const loose: any = answer;
/* oxlint-disable no-console -- nor can a block directive's, however far past the width the reason runs on this line */
// @ts-expect-error a TypeScript directive applies to the next line, so its reason stays on this one however long it is
export const wrong: string = answer;
