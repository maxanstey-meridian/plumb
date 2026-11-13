using System.Text.Encodings.Web;
using System.Text.Json;

namespace Plumb.CSharpFacts;

// The output's shape is internal to this tool and lib/engine/csharp-facts.mjs, which are built and
// tested together: a table of the strings that repeat (files, type names, members), and everything
// else refers to it by index, with -1 for null. References are grouped by file, one row each.
internal static class FactsWriter
{
    private sealed class Strings
    {
        private readonly Dictionary<string, int> _index = new(StringComparer.Ordinal);
        public List<string> All { get; } = [];

        public int Of(string? value)
        {
            if (value is null)
            {
                return -1;
            }
            if (!_index.TryGetValue(value, out var found))
            {
                found = All.Count;
                _index[value] = found;
                All.Add(value);
            }
            return found;
        }
    }

    public static void Write(Options options, Loader loader, List<DocumentFacts> documents)
    {
        var strings = new Strings();
        using var stream = File.Create(options.Out);
        using var json = new Utf8JsonWriter(
            stream,
            new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }
        );

        // Everything but the string table is written first into memory, so the table can lead the
        // output.
        using var body = new MemoryStream();
        using (
            var writer = new Utf8JsonWriter(
                body,
                new JsonWriterOptions { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }
            )
        )
        {
            writer.WriteStartObject();
            WriteProjects(writer, options, loader);
            WriteDocuments(writer, strings, documents);
            WriteTypes(writer, strings, documents);
            WriteOutsideTypes(writer, strings, documents);
            WriteUsings(writer, strings, documents);
            WriteReferences(writer, strings, documents);
            WriteTables(writer, strings, documents);
            writer.WriteEndObject();
        }

        json.WriteStartObject();
        json.WriteStartArray("strings");
        foreach (var value in strings.All)
        {
            json.WriteStringValue(value);
        }
        json.WriteEndArray();
        json.Flush();
        // Splice the body's members after the table: its opening brace is dropped.
        var text = body.GetBuffer().AsSpan(1, (int)body.Length - 1);
        stream.Write(","u8);
        stream.Write(text);
    }

    private static void WriteProjects(Utf8JsonWriter writer, Options options, Loader loader)
    {
        writer.WriteStartArray("projects");
        foreach (
            var entry in loader.Entries.Values.OrderBy(entry => entry.Path, StringComparer.Ordinal)
        )
        {
            writer.WriteStartObject();
            writer.WriteString("path", Paths.Relative(options.Root, entry.Path));
            writer.WriteBoolean("loaded", entry.Loaded);
            writer.WriteStartArray("messages");
            foreach (var message in entry.Messages)
            {
                writer.WriteStringValue(message);
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteDocuments(
        Utf8JsonWriter writer,
        Strings strings,
        List<DocumentFacts> documents
    )
    {
        writer.WriteStartArray("documents");
        foreach (var document in documents)
        {
            writer.WriteNumberValue(strings.Of(document.File));
        }
        writer.WriteEndArray();
    }

    private static void WriteTypes(
        Utf8JsonWriter writer,
        Strings strings,
        List<DocumentFacts> documents
    )
    {
        // One entry per type per assembly, its parts from every document that declares it.
        var grouped =
            new Dictionary<(string Assembly, string Name), List<(string File, TypePart Part)>>();
        foreach (var document in documents)
        {
            foreach (var part in document.Parts)
            {
                var key = (part.Assembly, part.Name);
                if (!grouped.TryGetValue(key, out var parts))
                {
                    parts = [];
                    grouped[key] = parts;
                }
                parts.Add((document.File, part));
            }
        }
        writer.WriteStartArray("types");
        foreach (
            var ((assembly, name), parts) in grouped
                .OrderBy(pair => pair.Key.Name, StringComparer.Ordinal)
                .ThenBy(pair => pair.Key.Assembly, StringComparer.Ordinal)
        )
        {
            var first = parts[0].Part;
            writer.WriteStartObject();
            writer.WriteNumber("name", strings.Of(name));
            writer.WriteString("kind", first.Kind);
            writer.WriteNumber("namespace", strings.Of(first.Namespace));
            writer.WriteNumber("containing", strings.Of(first.Containing));
            writer.WriteString("access", first.Access);
            writer.WriteNumber("assembly", strings.Of(assembly));
            writer.WriteStartArray("baseTypes");
            foreach (var baseType in first.BaseTypes)
            {
                writer.WriteNumberValue(strings.Of(baseType));
            }
            writer.WriteEndArray();
            writer.WriteStartArray("parts");
            foreach (var (file, part) in parts)
            {
                writer.WriteStartArray();
                writer.WriteNumberValue(strings.Of(file));
                writer.WriteNumberValue(part.Start);
                writer.WriteNumberValue(part.End);
                // The frameworks a multi-target project's part is declared under; a single-target
                // project's has none.
                if (part.Frameworks is { } frameworks)
                {
                    writer.WriteStartArray();
                    foreach (var framework in frameworks)
                    {
                        writer.WriteNumberValue(strings.Of(framework));
                    }
                    writer.WriteEndArray();
                }
                writer.WriteEndArray();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    // The outside types the facts record, each once with its bases, apart from `types` because
    // those are the repo's own.
    private static void WriteOutsideTypes(
        Utf8JsonWriter writer,
        Strings strings,
        List<DocumentFacts> documents
    )
    {
        writer.WriteStartArray("outsideTypes");
        foreach (
            var outside in OutsideTypeFact.Union(
                documents.SelectMany(document => document.OutsideTypes)
            )
        )
        {
            writer.WriteStartObject();
            writer.WriteNumber("name", strings.Of(outside.Name));
            writer.WriteStartArray("baseTypes");
            foreach (var baseType in outside.BaseTypes)
            {
                writer.WriteNumberValue(strings.Of(baseType));
            }
            writer.WriteEndArray();
            writer.WriteStartArray("baseClasses");
            foreach (var baseClass in outside.BaseClasses)
            {
                writer.WriteNumberValue(strings.Of(baseClass));
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }

    private static void WriteUsings(
        Utf8JsonWriter writer,
        Strings strings,
        List<DocumentFacts> documents
    )
    {
        writer.WriteStartArray("usings");
        foreach (var document in documents)
        {
            foreach (var directive in document.Usings)
            {
                writer.WriteStartObject();
                writer.WriteNumber("file", strings.Of(document.File));
                writer.WriteNumber("start", directive.Start);
                writer.WriteBoolean("global", directive.Global);
                writer.WriteBoolean("static", directive.Static);
                writer.WriteNumber("alias", strings.Of(directive.Alias));
                writer.WriteNumber("target", strings.Of(directive.Target));
                writer.WriteString("targetKind", directive.TargetKind);
                writer.WriteNumber("type", strings.Of(directive.Type));
                writer.WriteNumber("assembly", strings.Of(directive.Assembly));
                if (directive.Arguments is { Count: > 0 } arguments)
                {
                    // [[type, assembly]…]: the types inside a type target.
                    writer.WriteStartArray("arguments");
                    foreach (var argument in arguments)
                    {
                        writer.WriteStartArray();
                        writer.WriteNumberValue(strings.Of(argument.Type));
                        writer.WriteNumberValue(strings.Of(argument.Assembly));
                        writer.WriteEndArray();
                    }
                    writer.WriteEndArray();
                }
                writer.WriteEndObject();
            }
        }
        writer.WriteEndArray();
    }

    // [file, [[start, end, from, fromMember, to, assembly, member, written, qualifier, external,
    // namespace]…]]
    private static void WriteReferences(
        Utf8JsonWriter writer,
        Strings strings,
        List<DocumentFacts> documents
    )
    {
        writer.WriteStartArray("references");
        foreach (var document in documents)
        {
            if (document.References.Count == 0)
            {
                continue;
            }
            writer.WriteStartArray();
            writer.WriteNumberValue(strings.Of(document.File));
            writer.WriteStartArray();
            foreach (var use in document.References)
            {
                writer.WriteStartArray();
                writer.WriteNumberValue(use.Start);
                writer.WriteNumberValue(use.End);
                writer.WriteNumberValue(strings.Of(use.From));
                writer.WriteNumberValue(strings.Of(use.FromMember));
                writer.WriteNumberValue(strings.Of(use.To));
                writer.WriteNumberValue(strings.Of(use.Assembly));
                writer.WriteNumberValue(strings.Of(use.Member));
                writer.WriteNumberValue((int)use.Written);
                writer.WriteNumberValue(use.Qualifier ? 1 : 0);
                writer.WriteNumberValue(use.External ? 1 : 0);
                writer.WriteNumberValue(strings.Of(use.Namespace));
                writer.WriteEndArray();
            }
            writer.WriteEndArray();
            writer.WriteEndArray();
        }
        writer.WriteEndArray();
    }

    private static void WriteTables(
        Utf8JsonWriter writer,
        Strings strings,
        List<DocumentFacts> documents
    )
    {
        writer.WriteStartArray("tables");
        foreach (var document in documents)
        {
            foreach (var table in document.Tables)
            {
                writer.WriteStartObject();
                writer.WriteNumber("file", strings.Of(document.File));
                writer.WriteNumber("start", table.Start);
                writer.WriteString("method", table.Method);
                writer.WriteNumber("schema", strings.Of(table.Schema));
                writer.WriteNumber("table", strings.Of(table.Table));
                writer.WriteEndObject();
            }
        }
        writer.WriteEndArray();
        writer.WriteStartArray("snapshotTables");
        foreach (var document in documents)
        {
            foreach (var table in document.SnapshotTables)
            {
                writer.WriteStartObject();
                writer.WriteNumber("file", strings.Of(document.File));
                writer.WriteNumber("start", table.Start);
                writer.WriteNumber("entity", strings.Of(table.Entity));
                writer.WriteString("method", table.Method);
                writer.WriteNumber("schema", strings.Of(table.Schema));
                writer.WriteNumber("table", strings.Of(table.Table));
                writer.WriteEndObject();
            }
        }
        writer.WriteEndArray();
        writer.WriteStartArray("defaultSchemas");
        foreach (var document in documents)
        {
            foreach (var schema in document.DefaultSchemas)
            {
                writer.WriteStartObject();
                writer.WriteNumber("file", strings.Of(document.File));
                writer.WriteNumber("start", schema.Start);
                writer.WriteNumber("schema", strings.Of(schema.Schema));
                writer.WriteEndObject();
            }
        }
        writer.WriteEndArray();
    }
}
