namespace App.Modules.Billing;

// The bare name resolves to the namespace's own RivetActionResult, declared in another file, before `using Rivet;`:
// building a result from it copies nothing of Rivet's.
public sealed class InvoiceRelay
{
    public IResult Send(RivetActionResult invoice) => Results.Json(invoice.Value, statusCode: invoice.StatusCode);
}
