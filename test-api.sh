#!/bin/bash

# Test script for design API with lazy spec generation
# Requires CHAINCRAFT_GAMEBUILDER_API_KEY environment variable

set -e

# Check for API key
if [ -z "$CHAINCRAFT_GAMEBUILDER_API_KEY" ]; then
  echo "Error: CHAINCRAFT_GAMEBUILDER_API_KEY environment variable not set"
  exit 1
fi

API_KEY="$CHAINCRAFT_GAMEBUILDER_API_KEY"
BASE_URL="http://localhost:3000/api/design"
CONVERSATION_ID="test-api-$(date +%s)"

echo "=== Testing Design API with Lazy Spec Generation ==="
echo "Conversation ID: $CONVERSATION_ID"
echo ""

# Turn 1: Initial request (should generate spec immediately)
echo "--- Turn 1: Initial Request ---"
RESPONSE1=$(curl -s -X POST "$BASE_URL/conversation/continue" \
  -H "Content-Type: application/json" \
  -H "x-chaincraft-api-key: $API_KEY" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"userMessage\": \"Create a simple dice rolling game for 2 players.\"
  }")

echo "$RESPONSE1" | jq '{
  hasSpec: (.specification != null),
  specVersion: .specification.version,
  hasPendingChanges: (.pendingSpecChanges != null),
  pendingChangesCount: (.pendingSpecChanges | length),
  consolidationThreshold: .consolidationThreshold,
  consolidationCharLimit: .consolidationCharLimit,
  response: (.designResponse | .[0:150] + "...")
}'

echo ""

# Turn 2: Request a change (should accumulate, not generate)
echo "--- Turn 2: Request Change (should accumulate) ---"
RESPONSE2=$(curl -s -X POST "$BASE_URL/conversation/continue" \
  -H "Content-Type: application/json" \
  -H "x-chaincraft-api-key: $API_KEY" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"userMessage\": \"Add a scoring system.\"
  }")

echo "$RESPONSE2" | jq '{
  hasSpec: (.specification != null),
  specVersion: .specification.version,
  hasPendingChanges: (.pendingSpecChanges != null),
  pendingChangesCount: (.pendingSpecChanges | length),
  pendingChanges: .pendingSpecChanges,
  consolidationThreshold: .consolidationThreshold,
  response: (.designResponse | .[0:150] + "...")
}'

echo ""

# Turn 3: Request another change (should accumulate)
echo "--- Turn 3: Another Change (should accumulate) ---"
RESPONSE3=$(curl -s -X POST "$BASE_URL/conversation/continue" \
  -H "Content-Type: application/json" \
  -H "x-chaincraft-api-key: $API_KEY" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"userMessage\": \"Add victory conditions.\"
  }")

echo "$RESPONSE3" | jq '{
  hasSpec: (.specification != null),
  specVersion: .specification.version,
  hasPendingChanges: (.pendingSpecChanges != null),
  pendingChangesCount: (.pendingSpecChanges | length),
  pendingChanges: .pendingChanges,
  response: (.designResponse | .[0:150] + "...")
}'

echo ""

# Turn 4: Force spec generation
echo "--- Turn 4: Force Spec Generation ---"
RESPONSE4=$(curl -s -X POST "$BASE_URL/conversation/continue" \
  -H "Content-Type: application/json" \
  -H "x-chaincraft-api-key: $API_KEY" \
  -d "{
    \"conversationId\": \"$CONVERSATION_ID\",
    \"userMessage\": \"Add a special rule for ties.\",
    \"forceSpecGeneration\": true
  }")

echo "$RESPONSE4" | jq '{
  hasSpec: (.specification != null),
  specVersion: .specification.version,
  hasPendingChanges: (.pendingSpecChanges != null),
  pendingChangesCount: (.pendingSpecChanges | length),
  hasSpecDiff: (.specDiff != null),
  response: (.designResponse | .[0:150] + "...")
}'

echo ""
echo "=== Test Complete ==="
echo ""
echo "Summary:"
echo "- Turn 1 should generate spec immediately (version 1)"
echo "- Turn 2-3 should accumulate changes (pending changes > 0)"
echo "- Turn 4 should force generation (version 2, pending changes = 0)"
