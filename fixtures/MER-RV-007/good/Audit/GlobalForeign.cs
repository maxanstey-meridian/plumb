// The type ../Modules/Orders/ForeignAdapterNames.cs:28 names as global::RivetActionResult. It sits in this project
// because App's AliasedNamesakes.cs and VendorAliasedNamesakes.cs alias that same name at the top of their files,
// which a global type of that name in App would conflict with (CS0576).
public sealed record RivetActionResult(int StatusCode, object? Value);
