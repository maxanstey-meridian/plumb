using Dapper;
using Npgsql;

public sealed class PostgresXRepository
{
    public async Task<string?> GetNameAsync(Guid id, CancellationToken ct)
    {
        return await _conn.QuerySingleOrDefaultAsync<string?>(
            new CommandDefinition("SELECT name FROM x WHERE id = @id", new { id }, cancellationToken: ct));
    }
}
