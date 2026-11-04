using Rivet;

// A file's own alias of another type reaches only the namespace block it's written in: outside it the bare name is
// still Rivet's.
namespace App.Modules.Common.Vendored
{
    using RivetActionResult = Vendor.Http.Adapted;

    public static class VendorSend
    {
        public static IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value);
    }
}

namespace App.Modules.Common.Plain
{
    public static class PlainSend
    {
        public static IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value);
    }
}
