#!/bin/sh
# Mirrors what the Dockerfile does, so `node .next/standalone/server.js` behaves
# locally exactly as the image does: static assets and the migration SQL sit
# next to the server, which chdirs to its own directory at startup.
set -e
rm -rf .next/standalone/drizzle .next/standalone/.next/static .next/standalone/public
cp -R drizzle .next/standalone/drizzle
mkdir -p .next/standalone/.next
cp -R .next/static .next/standalone/.next/static
cp -R public .next/standalone/public
echo "standalone staged"
