namespace App.Modules.Orders.Infrastructure;
public sealed class EfOrderRepository(Db db)
{
    public async Task<Order?> FindAsync(Guid id)
    {
        db.Remove(new Order(id));
        await db.SaveChangesAsync();
        return null;
    }
}
