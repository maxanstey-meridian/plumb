using App.Modules.Forms.Domain;
namespace App.Common.Ports;
public interface IConfirmReader
{
    FormSnapshot Read();
}
