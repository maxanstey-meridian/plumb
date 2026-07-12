using App.Modules.Forms.Contracts;

namespace App.Integration;
public sealed class FormsBridge(App.Modules.Forms.Application.Ports.IFormLookup lookup, FormSummary summary) { }
