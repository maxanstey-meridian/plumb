#!/bin/sh
# Applies the migrations, including the invoices_immutable trigger, on release.
set -eu
psql -f refuse.sql
