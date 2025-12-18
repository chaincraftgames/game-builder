#!/bin/bash

# GameBuilder AI Generation - Quick Reference
# Shows available commands and usage examples

echo "🎮 ChainCraft GameBuilder - AI Generation Tools"
echo "================================================"
echo ""

echo "📁 Directory Structure:"
echo "game-builder/src/ai/generate/"
echo "├── scripts/    # Setup and utility scripts"
echo "├── prompts/    # AI generation prompts"
echo "├── tools/      # Custom tools (future)"
echo "└── README.md   # Detailed documentation"
echo ""

echo "🚀 Quick Start:"
echo "1. Setup: ./game-builder/src/ai/generate/scripts/setup-openswe.sh"
echo "2. Add API key to: open-swe/apps/cli/.env"
echo "3. Generate: cd open-swe/apps/cli && corepack yarn cli"
echo ""

echo "📝 Available Prompts:"
for prompt in game-builder/src/ai/generate/prompts/*.md; do
    if [ -f "$prompt" ]; then
        echo "- $(basename "$prompt" .md)"
    fi
done
echo ""

echo "🔧 Available Scripts:"
for script in game-builder/src/ai/generate/scripts/*.sh; do
    if [ -f "$script" ] && [ -x "$script" ]; then
        echo "- $(basename "$script")"
    fi
done
echo ""

echo "📍 Output Locations:"
echo "- Generated games: generated-games/"
echo "- OpenSWE config: open-swe/apps/cli/"
echo "- Framework reference: text-game-engine/"
echo ""

echo "💡 Example Game Generation Request:"
echo '"Create a turn-based RPG combat game using ChainCraft ECS.'
echo 'Include character entities with health/attack components,'
echo 'a combat system, player actions, and win/lose conditions.'
echo 'Study the RPS example for patterns."'
echo ""

echo "📚 For detailed documentation: cat game-builder/src/ai/generate/README.md"
