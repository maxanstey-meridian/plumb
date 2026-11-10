// Just enough of Entity Framework Core's table mapping, so the fixture needs no package.
namespace Microsoft.EntityFrameworkCore
{
    public static class RelationalEntityTypeBuilderExtensions
    {
        public static Metadata.Builders.EntityTypeBuilder<T> ToTable<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder<T> ToView<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name) where T : class => builder;
    }
}

namespace Microsoft.EntityFrameworkCore.Metadata.Builders
{
    public class EntityTypeBuilder<T> where T : class { }
}
