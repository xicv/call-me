#!/bin/bash
# Development build script - for contributing to callme
# Users should install via: claude mcp add callme -- npx -y callme-mcp

set -e

echo "Building callme for development..."

if ! command -v bun &> /dev/null; then
    echo "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

cd mcp-server
bun install
bun run build
cd ..

echo "Build complete!"
echo ""
echo "For users: Install via npm (no build required):"
echo "  claude mcp add callme -- npx -y callme-mcp"
echo ""
echo "For development: Test local build with:"
echo "  claude mcp add callme-dev -- node $(pwd)/mcp-server/dist/index.js"
