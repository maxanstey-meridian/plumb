#!/bin/bash
# Self-test for Meridian.Analyzers — the dotnet-side analogue of plumb --self-test
# (FABLE_CONTRACT.md §8/§11.4). Separate from plumb --self-test on purpose: it
# needs the dotnet SDK and real builds, which the default self-test must not.
# fixtures/bad must FAIL its build with all mirrored diagnostics;
# fixtures/good must build clean with the same analyzer attached.
set -u
cd "$(dirname "$0")"
fail=0

bad=$(dotnet build fixtures/bad -nologo -v q 2>&1)
if [ $? -eq 0 ]; then echo "FAIL bad: build succeeded, expected analyzer errors"; fail=1; fi
for id in MERBE001 MERBE002 MERBE005 MERBE008 MERBE009 MERBE016 MERRV011; do
  if ! grep -q "$id" <<<"$bad"; then echo "FAIL bad: missing $id"; fail=1; fi
done
for expected in \
  'FullyQualifiedDependency.cs.*MERBE005' \
  'GlobalUsingDependency.cs.*MERBE001' \
  'FrameworkDependencies.cs.*MERBE001' \
  'Application/FullyQualifiedDependency.cs.*MERBE002' \
  'LeakyBillingContract.cs.*MERBE016' \
  'AuthContract.cs.*MERRV011'; do
  if ! grep -q "$expected" <<<"$bad"; then echo "FAIL bad: missing semantic diagnostic matching $expected"; fail=1; fi
done
if ! grep -q 'LoginHandler.cs(13,.*MERBE009' <<<"$bad"; then echo "FAIL bad: missing semantic alias MERBE009"; fail=1; fi

good=$(dotnet build fixtures/good -nologo -v q 2>&1)
if [ $? -ne 0 ]; then echo "FAIL good: build failed"; echo "$good"; fail=1; fi
if grep -q "MERBE" <<<"$good"; then echo "FAIL good: unexpected MERBE diagnostic"; fail=1; fi

[ $fail -eq 0 ] && echo "dotnet self-test: ok (bad fails with all mirrored diagnostics, good builds clean)"
exit $fail
