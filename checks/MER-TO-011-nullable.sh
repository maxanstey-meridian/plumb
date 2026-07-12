#!/usr/bin/env bash
# MER-TO-011 — nullable + implicit usings enabled in every project
# Exception: a Directory.Build.props that sets them covers all projects beneath it.
# DOC: tools.md#default-stack-1
root="$1"; [ -d "$root" ] || exit 2
root="$(cd "$root" && pwd)"
property_state() {
  perl -0777 -e '
    my ($property, $file) = @ARGV;
    open my $fh, "<", $file or exit 0;
    local $/; my $xml = <$fh>;
    $xml =~ s/<!--.*?-->//gs;
    my $value;
    while ($xml =~ m{<PropertyGroup\b([^>]*)>(.*?)</PropertyGroup>}gsi) {
      next if $1 =~ /\bCondition\s*=/i;
      my $body = $2;
      while ($body =~ m{<\Q$property\E\b([^>]*)>(.*?)</\Q$property\E>}gsi) {
        next if $1 =~ /\bCondition\s*=/i;
        $value = $2; $value =~ s/^\s+|\s+$//g;
      }
    }
    print "present:", lc($value) if defined $value;
  ' "$1" "$2"
}
setting_enabled() {
  state="$(property_state "$1" "$2")"
  if [ -z "$state" ] && [ -n "$3" ]; then
    state="$(property_state "$1" "$3")"
  fi
  [ "$state" = "present:enable" ]
}
find "$root" -name '*.csproj' -not -path '*/obj/*' -not -path '*/bin/*' -not -path '*/node_modules/*' 2>/dev/null \
| while read -r f; do
  rel="${f#"$root"/}"
  dir="$(dirname "$f")"
  props=""
  while :; do
    if [ -f "$dir/Directory.Build.props" ]; then
      props="$dir/Directory.Build.props"
      break
    fi
    [ "$dir" = "$root" ] && break
    dir="$(dirname "$dir")"
  done
  setting_enabled Nullable "$f" "$props" || \
    printf 'MER-TO-011\terror\t%s:0\tenable nullable reference types\ttools.md#default-stack-1\n' "$rel"
  setting_enabled ImplicitUsings "$f" "$props" || \
    printf 'MER-TO-011\twarn\t%s:0\tenable implicit usings (Meridian tooling default)\ttools.md#default-stack-1\n' "$rel"
done
exit 0
