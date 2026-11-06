#!/bin/sh
# Eklentiyi dist/ altında .xpi olarak paketler.
set -e
cd "$(dirname "$0")"
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
mkdir -p dist
OUT="dist/zotero-hafif-$VERSION.xpi"
rm -f "$OUT"
zip -qr "$OUT" manifest.json bootstrap.js prefs.js content locale -x '*.DS_Store'
echo "$OUT"
