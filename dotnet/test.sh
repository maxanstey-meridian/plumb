#!/bin/bash
# Self-test for Meridian.Analyzers — the dotnet-side analogue of plumb --self-test
# (FABLE_CONTRACT.md §8/§11.4). Separate from plumb --self-test on purpose: it
# needs the dotnet SDK and real builds, which the default self-test must not.
# fixtures/bad must FAIL its build with MERBE001 + MERBE002 + MERBE005;
# fixtures/good must build clean with the same analyzer attached.
set -u
cd "$(dirname "$0")"
fail=0

bad=$(dotnet build fixtures/bad -nologo -v q 2>&1)
if [ $? -eq 0 ]; then echo "FAIL bad: build succeeded, expected analyzer errors"; fail=1; fi
for id in MERBE001 MERBE002 MERBE005; do
  if ! grep -q "$id" <<<"$bad"; then echo "FAIL bad: missing $id"; fail=1; fi
done

good=$(dotnet build fixtures/good -nologo -v q 2>&1)
if [ $? -ne 0 ]; then echo "FAIL good: build failed"; echo "$good"; fail=1; fi
if grep -q "MERBE" <<<"$good"; then echo "FAIL good: unexpected MERBE diagnostic"; fail=1; fi

[ $fail -eq 0 ] && echo "dotnet self-test: ok (bad fails with MERBE001/002/005, good builds clean)"
exit $fail
