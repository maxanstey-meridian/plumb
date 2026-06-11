// §7 exception: in a file declaring an interface, only the interfaces are
// candidates — port signature DTOs are received via var, so consumer counts
// systematically undercount (AddressDto below is referenced by one module).
namespace Acme.Common.Ports;
public interface IAddressLookup { object Find(string q); }
public sealed record AddressDto(string Line1);
