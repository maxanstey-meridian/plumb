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
/* oxlint-disable no-console -- a block directive's opening line is left whole too, however far past the width it runs */
/* oxlint-enable no-console -- and so is the line that ends it, which is read from its opening line in the same way */
// eslint-enable @typescript-eslint/no-explicit-any -- an enable directive is a directive too, so this line stays whole
// @ts-expect-error a TypeScript directive applies to the next line, so its reason stays on this one however long it is
export const wrong: string = answer;
// @ts-ignore an ignore directive applies to the next line just like expect-error, so its reason stays here however long
export const ignored: string = answer;
// oxfmt-ignore a formatter's ignore directive applies to the next statement, so its explanation stays on this one line
export const spaced  =  answer;
// prettier-ignore an older repo's formatter reads its ignore directive from this one line, so the words after it stay here
/* v8 ignore next -- a coverage directive is read from its one line, so its reason can't move down to a line of its own */
/* c8 ignore next -- and c8's spelling of the same coverage directive is read from its opening line exactly the same way */
/* istanbul ignore next -- istanbul's older spelling of the coverage directive is left whole on this line in the same way */
// biome-ignore lint/suspicious/noExplicitAny: biome's ignore directive takes its reason after a colon on the same line
// @ts-ignore: TypeScript also reads an ignore directive with a colon straight after it, so this line is left whole too
export const colon: string = answer;
// biome-ignore-all lint/suspicious/noExplicitAny: Biome 2's file-wide form is read from its one line in the same way
