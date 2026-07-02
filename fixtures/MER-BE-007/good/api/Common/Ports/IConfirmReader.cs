using App.Common.Domain;
namespace App.Common.Ports;
public interface IConfirmReader
{
    FormReference Read();
}
