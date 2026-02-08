#!/bin/bash
# Internal API CLI for game-builder
# Usage: ./internal-api.sh [command] [options]

set -e

# Configuration
INTERNAL_TOKEN="${CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN:-}"
BASE_URL="${CHAINCRAFT_BASE_URL:-http://localhost:3000}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_error() {
  echo -e "${RED}✗ $1${NC}" >&2
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_usage() {
  cat << EOF
Internal API CLI for game-builder

Usage: ./internal-api.sh <command> [options]

Commands:
  cleanup              Run checkpoint cleanup (removes old completed game sessions)
  heap-snapshot        Generate and download a heap snapshot for memory analysis
  help                 Show this help message

Options:
  --url <url>          Base URL (default: http://localhost:3000)
  --token <token>      Internal API token (or set CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN)

Environment Variables:
  CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN  Internal API authentication token
  CHAINCRAFT_BASE_URL                         Base URL for the API

Examples:
  # Run cleanup on local server
  ./internal-api.sh cleanup

  # Get heap snapshot from production
  ./internal-api.sh heap-snapshot --url https://api.chaincraft.games

  # Run cleanup on Railway with explicit token
  ./internal-api.sh cleanup --url https://your-app.up.railway.app --token your-token

EOF
}

check_token() {
  if [ -z "$INTERNAL_TOKEN" ]; then
    print_error "No authentication token provided"
    print_info "Set CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN or use --token flag"
    exit 1
  fi
}

check_dependencies() {
  if ! command -v curl &> /dev/null; then
    print_error "curl is required but not installed"
    exit 1
  fi
}

# Command: cleanup
cmd_cleanup() {
  check_token
  
  print_info "Running cleanup on $BASE_URL"
  
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    -H "X-Internal-Token: $INTERNAL_TOKEN" \
    "$BASE_URL/internal/cleanup")
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" = "200" ]; then
    print_success "Cleanup completed successfully"
    if command -v jq &> /dev/null; then
      echo "$BODY" | jq .
    else
      echo "$BODY"
    fi
  else
    print_error "Cleanup failed (HTTP $HTTP_CODE)"
    echo "$BODY"
    exit 1
  fi
}

# Command: heap-snapshot
cmd_heap_snapshot() {
  check_token
  
  OUTPUT_FILE="heap-snapshot-$(date +%s).heapsnapshot"
  
  print_info "Generating heap snapshot from $BASE_URL"
  
  HTTP_CODE=$(curl -s -w "%{http_code}" -X POST \
    -H "X-Internal-Token: $INTERNAL_TOKEN" \
    "$BASE_URL/internal/heap-snapshot" \
    --output "$OUTPUT_FILE")
  
  if [ "$HTTP_CODE" = "200" ]; then
    if [ -f "$OUTPUT_FILE" ]; then
      FILE_SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')
      print_success "Heap snapshot saved: $OUTPUT_FILE ($FILE_SIZE)"
      echo ""
      print_info "To analyze the heap snapshot:"
      echo "  1. Open Chrome DevTools (F12 or chrome://inspect)"
      echo "  2. Go to the Memory tab"
      echo "  3. Click 'Load' and select: $OUTPUT_FILE"
      echo "  4. Inspect memory usage, object counts, and retention paths"
    else
      print_error "File was not created"
      exit 1
    fi
  else
    print_error "Failed to generate heap snapshot (HTTP $HTTP_CODE)"
    if [ -f "$OUTPUT_FILE" ]; then
      cat "$OUTPUT_FILE"
      rm "$OUTPUT_FILE"
    fi
    exit 1
  fi
}

# Parse arguments
COMMAND=""
while [[ $# -gt 0 ]]; do
  case $1 in
    cleanup|heap-snapshot|help)
      COMMAND=$1
      shift
      ;;
    --url)
      BASE_URL="$2"
      shift 2
      ;;
    --token)
      INTERNAL_TOKEN="$2"
      shift 2
      ;;
    *)
      print_error "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

# Check dependencies
check_dependencies

# Execute command
case $COMMAND in
  cleanup)
    cmd_cleanup
    ;;
  heap-snapshot)
    cmd_heap_snapshot
    ;;
  help|"")
    print_usage
    exit 0
    ;;
  *)
    print_error "Unknown command: $COMMAND"
    print_usage
    exit 1
    ;;
esac
