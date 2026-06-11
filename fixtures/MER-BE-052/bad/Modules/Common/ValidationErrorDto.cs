namespace App.Common;
public sealed record ValidationErrorDto(IReadOnlyDictionary<string, string[]> Errors);
