namespace App.Modules.Orders.Infrastructure;
public sealed class EfOrderRepository(Db db)
{
    public Task<Order?> FindAsync(Guid id) => db.Orders.FirstOrDefaultAsync(x => x.Id == id);
    public async Task<Order> GetOrCreateAsync(Guid id) { db.Add(new Order(id)); await db.SaveChangesAsync(); return new Order(id); }
    public async Task SaveAsync(Order order) { db.Update(order); await db.SaveChangesAsync(); }
}
