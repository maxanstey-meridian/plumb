public sealed class CheckoutTests
{
    public void Calls_dependencies_in_order()
    {
        Received.InOrder(() => { gateway.Charge(); repository.Save(); });
        var sequence = new MockSequence();
        gateway.InSequence(sequence).Setup(x => x.Charge());
    }
}
