#!/bin/bash

# OpenSWE Setup Script for ChainCraft GameBuilder
# This script sets up OpenSWE for local game generation

echo "🎮 Setting up OpenSWE for ChainCraft GameBuilder..."

# Navigate to workspace root (4 levels up from scripts/)
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
echo "📁 Workspace root: $WORKSPACE_ROOT"

# Navigate to OpenSWE directory
cd "$WORKSPACE_ROOT/open-swe" || exit 1

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing OpenSWE dependencies..."
    corepack yarn install
else
    echo "✅ Dependencies already installed"
fi

# Build the CLI
echo "🔨 Building OpenSWE CLI..."
corepack yarn workspace @openswe/cli build

# Setup generated-games directory with OpenSWE configuration
echo "📝 Setting up generated-games directory..."
"$WORKSPACE_ROOT/game-builder/src/ai/generate/scripts/setup-generated-games.sh"

echo "✅ Setup complete!"
echo ""
echo "🚀 To start using OpenSWE for game generation:"
echo "1. Add your API keys to open-swe/apps/cli/.env"
echo "2. Run: cd open-swe/apps/cli && corepack yarn cli"
echo "3. Ask OpenSWE to create a game using the ChainCraft framework"
echo ""
echo "📁 Generated games will be saved to: generated-games/"
echo "📝 Game generation instructions: game-builder/src/ai/generate/prompts/"
