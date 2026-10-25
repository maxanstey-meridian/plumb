namespace App;

public static class Answers
{
    /// the formatter keeps code to the line width but it never wraps a comment, so this one
    /// is wrapped by hand
    /// https://example.com/a/very/long/path/that/cannot/be/broken/anywhere/because/it/is/one/single/token/of/text
    public const int Value = 42;
    // ReSharper disable once UnusedMember.Global, UnusedAutoPropertyAccessor.Global, InconsistentNaming, MemberCanBePrivate.Global
    public const int Unused = 0;
    // ReSharper restore UnusedMember.Global, UnusedAutoPropertyAccessor.Global, InconsistentNaming, MemberCanBePrivate.Global
    // csharpier-ignore -- CSharpier reads its ignore directive from this one line, so the reason after it stays on the line too
    public const int Spaced  =  1;
    public const int Trailing = 1; // a comment after code shares the code's line, which CSharpier owns, so it isn't measured

    public const string Script = """
        // a raw string's text is data, not a comment, so this long line inside it is never measured as one
        * nor is a line that happens to start with an asterisk inside it, however far past the width it goes
        """;

    public const string Verbatim = @"
// a verbatim string's text is data too, so this long line inside it is never measured as a comment line
";
}
