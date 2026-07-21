namespace App.Common;
public sealed record PaginatedResponse<T>(List<T> Items);
