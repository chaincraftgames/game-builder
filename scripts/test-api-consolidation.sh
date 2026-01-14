#!/bin/bash

# Script to run the API consolidation test
# This test verifies that the API responds correctly during auto-consolidation

set -e

# Check for API key
if [ -z "$CHAINCRAFT_GAMEBUILDER_API_KEY" ]; then
  echo "Error: CHAINCRAFT_GAMEBUILDER_API_KEY environment variable not set"
  exit 1
fi

echo "=== Running Design API Consolidation Test ==="
echo ""
echo "This test will:"
echo "  1. Start a test Fastify server"
echo "  2. Execute multiple conversation turns"
echo "  3. Trigger auto-consolidation via char/plan thresholds"
echo "  4. Verify responses are received for all requests"
echo ""

cd "$(dirname "$0")/.." || exit 1

# Build first (required for imports)
echo "Building project..."
npm run build

echo ""
echo "Running test..."
echo ""

# Create logs directory if it doesn't exist
mkdir -p logs

# Run the test using Jest directly (same pattern as other test scripts)
# Pipe to tee so we see output AND save to file
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/design-api-consolidation.test.ts --verbose 2>&1 | tee logs/api-consolidation-test.log

echo ""
echo "=== Test Complete ==="
echo "Full logs saved to: logs/api-consolidation-test.log"
