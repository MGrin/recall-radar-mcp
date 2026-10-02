#!/bin/sh
# Builds the MCPB bundle the MCP Registry entry (server.json) points at:
#   sh scripts/pack-mcpb.sh   ->  build/household-recall-watch.mcpb, and its SHA-256
# The bundle is a zip of mcpb/manifest.json, dist/ and production node_modules; it runs the stdio entry.
set -eu
cd "$(dirname "$0")/.."
out=build/household-recall-watch.mcpb
stage=build/mcpb
rm -rf "$stage" "$out"
mkdir -p "$stage"
npm run build
cp -R dist package.json package-lock.json LICENSE README.md mcpb/manifest.json "$stage/"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund && rm package-lock.json)
(cd "$stage" && zip -qr -X "../$(basename "$out")" .)
openssl dgst -sha256 "$out"
