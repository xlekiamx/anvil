#!/bin/bash
set -e

REPO="xlekiamx/anvil"
NAME="anvil"
VERSION="${1:-latest}"

echo "Installing $NAME..."

# Check for node
if ! command -v node &> /dev/null; then
  echo "Error: Node.js is required but not installed."
  exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
  echo "Error: npm is required but not installed."
  exit 1
fi

# Get download URL
if [ "$VERSION" = "latest" ]; then
  DOWNLOAD_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep "browser_download_url.*\.tgz" \
    | cut -d '"' -f 4)
else
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$NAME-${VERSION#v}.tgz"
fi

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Could not find release. Check https://github.com/$REPO/releases"
  exit 1
fi

# Download and install
TMPDIR=$(mktemp -d)
echo "Downloading from $DOWNLOAD_URL..."
curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR/$NAME.tgz"
echo "Installing globally..."
npm install -g "$TMPDIR/$NAME.tgz"
rm -rf "$TMPDIR"

echo ""
echo "$NAME installed successfully!"
echo "Run 'anvil --help' to get started."
