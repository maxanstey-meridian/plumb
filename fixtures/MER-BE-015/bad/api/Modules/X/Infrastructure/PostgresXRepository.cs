using Npgsql;

public sealed class PostgresXRepository
{
    public async Task<string?> GetNameAsync(Guid id, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT name FROM x WHERE id = @id", _conn);
        cmd.Parameters.AddWithValue("id", id);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return reader.GetString(reader.GetOrdinal("name"));
    }
}
