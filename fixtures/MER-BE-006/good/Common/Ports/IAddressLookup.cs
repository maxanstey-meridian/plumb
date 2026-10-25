// A port's consumers consume the DTOs its signatures name: AddressDto has the
// port's two consumers, though only Forms writes its name.
namespace Acme.Common.Ports;
public interface IAddressLookup { AddressDto Find(string q); }
public sealed record AddressDto(string Line1);
