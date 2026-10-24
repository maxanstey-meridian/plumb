using App.Modules.Forms.Domain;
namespace App.Common.Ports;
public interface IFormLister
{
    // The enclosing namespace's FormSnapshot wins over the using's.
    IReadOnlyList<FormSnapshot> List();
}
