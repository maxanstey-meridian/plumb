namespace App.Common;
public sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors);
