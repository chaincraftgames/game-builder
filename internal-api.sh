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
  memory-stats         Show detailed memory usage breakdown
  db-stats             Show database checkpoint storage statistics
  game-export          Export a game (design state and artifacts) for local import
  game-import          Import an exported game into local environment
  help                 Show this help message

Options:
  --url <url>          Base URL (default: http://localhost:3000)
  --token <token>      Internal API token (or set CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN)
  
  game-export options:
    --game-id <id>     Game/conversation ID to export (required)
    --version <n>      Specific version to export (optional, defaults to latest)
    --artifacts        Include spec processing artifacts (optional)
    --output <dir>     Output directory (default: data/exports)
  
  game-import options:
    --file <path>      Path to exported game JSON file (required)
    --wallet <addr>    Wallet address for game owner (default: "local")

Environment Variables:
  CHAINCRAFT_GAMEBUILDER_INTERNAL_API_TOKEN  Internal API authentication token
  CHAINCRAFT_BASE_URL                         Base URL for the API

Examples:
  # Run cleanup on local server
  ./internal-api.sh cleanup

  # Get heap snapshot from production
  ./internal-api.sh heap-snapshot --url https://api.chaincraft.games

  # Check memory stats
  ./internal-api.sh memory-stats

  # Export latest version of a game with artifacts
  ./internal-api.sh game-export --game-id abc123 --artifacts

  # Export specific version from production
  ./internal-api.sh game-export --game-id abc123 --version 2 --artifacts \\
    --url https://your-app.up.railway.app --token your-token

  # Import a game into local environment
  ./internal-api.sh game-import --file data/exports/abc123-v2.json

  # Import with custom wallet address
  ./internal-api.sh game-import --file data/exports/abc123-latest.json --wallet 0x123...

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

# Command: memory-stats
cmd_memory_stats() {
  check_token
  
  print_info "Fetching memory stats from $BASE_URL"
  
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    -H "X-Internal-Token: $INTERNAL_TOKEN" \
    "$BASE_URL/internal/memory-stats")
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" = "200" ]; then
    print_success "Memory stats retrieved"
    echo ""
    if command -v jq &> /dev/null; then
      echo "$BODY" | jq -r '
        "RSS (Total): \(.rss.mb)MB",
        "Heap Total: \(.heapTotal.mb)MB",
        "Heap Used: \(.heapUsed.mb)MB",
        "External (C++ objects): \(.external.mb)MB",
        "Array Buffers: \(.arrayBuffers.mb)MB",
        "Unaccounted: \(.unaccounted.mb)MB",
        "",
        "Breakdown:",
        "  • Heap accounts for \((.heapTotal.mb * 100 / .rss.mb) | floor)% of total",
        "  • External accounts for \((.external.mb * 100 / .rss.mb) | floor)% of total",
        "  • Unaccounted is \((.unaccounted.mb * 100 / .rss.mb) | floor)% of total"
      '
    else
      echo "$BODY"
    fi
  else
    print_error "Failed to get memory stats (HTTP $HTTP_CODE)"
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

# Command: db-stats
cmd_db_stats() {
  check_token
  
  print_info "Fetching database stats from $BASE_URL"
  
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    -H "X-Internal-Token: $INTERNAL_TOKEN" \
    "$BASE_URL/internal/db-stats")
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" = "200" ]; then
    print_success "Database stats retrieved"
    echo ""
    
    # Parse and format the response
    if command -v jq &> /dev/null; then
      echo "$BODY" | jq -r '
        "Database Size: \(.database.database_size)",
        "",
        "Checkpoint Blobs Table:",
        "  Total Size: \(.checkpointBlobs.tableSize.total_size)",
        "  Table Data: \(.checkpointBlobs.tableSize.table_size)",
        "  Indexes: \(.checkpointBlobs.tableSize.indexes_size)",
        "",
        "Checkpoint Statistics:",
        "  Row Count: \(.checkpointBlobs.stats.row_count)",
        "  Average Blob Size: \(.checkpointBlobs.stats.avg_blob_size)",
        "  Total Blob Data: \(.checkpointBlobs.stats.total_blob_data)",
        "",
        "Top 10 Largest Threads:",
        (.checkpointBlobs.largestThreads[] | 
          "  \(.thread_id): \(.checkpoint_count) checkpoints, \(.total_size) total (\(.avg_size) avg)")
      '
    else
      echo "$BODY"
    fi
  else
    print_error "Failed to get database stats (HTTP $HTTP_CODE)"
    echo "$BODY"
    exit 1
  fi
}

# Command: game-export
cmd_game_export() {
  check_token
  
  # Validate required parameters
  if [ -z "$GAME_ID" ]; then
    print_error "Game ID is required"
    print_info "Usage: ./internal-api.sh game-export --game-id <id> [--version N] [--artifacts]"
    exit 1
  fi
  
  # Build query parameters
  QUERY_PARAMS="gameId=$GAME_ID"
  
  if [ -n "$VERSION" ]; then
    QUERY_PARAMS="$QUERY_PARAMS&version=$VERSION"
  fi
  
  if [ "$ARTIFACTS" = "true" ]; then
    QUERY_PARAMS="$QUERY_PARAMS&artifacts=true"
  fi
  
  # Determine output filename
  if [ -n "$VERSION" ]; then
    OUTPUT_FILE="${OUTPUT_DIR}/${GAME_ID}-v${VERSION}.json"
  else
    OUTPUT_FILE="${OUTPUT_DIR}/${GAME_ID}-latest.json"
  fi
  
  # Ensure output directory exists
  mkdir -p "$OUTPUT_DIR"
  
  print_info "Exporting game $GAME_ID from $BASE_URL"
  if [ -n "$VERSION" ]; then
    print_info "Version: $VERSION"
  else
    print_info "Version: latest"
  fi
  if [ "$ARTIFACTS" = "true" ]; then
    print_info "Including artifacts: yes"
  fi
  
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET \
    -H "X-Internal-Token: $INTERNAL_TOKEN" \
    "$BASE_URL/internal/game-export?$QUERY_PARAMS")
  
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')
  
  if [ "$HTTP_CODE" = "200" ]; then
    # Save to file
    echo "$BODY" > "$OUTPUT_FILE"
    
    FILE_SIZE=$(ls -lh "$OUTPUT_FILE" | awk '{print $5}')
    print_success "Game exported: $OUTPUT_FILE ($FILE_SIZE)"
    
    # Show summary if jq is available
    if command -v jq &> /dev/null; then
      echo ""
      print_info "Export Summary:"
      echo "$BODY" | jq -r '
        "  Game ID: \(.metadata.gameId)",
        "  Version: \(.metadata.version)",
        "  Timestamp: \(.metadata.timestamp)",
        "  Has Artifacts: \(.metadata.hasArtifacts)",
        "  Title: \(.design.title // "Untitled")"
      '
    fi
    
    echo ""
    print_info "To import this game locally:"
    echo "  npm run import-game -- --file $OUTPUT_FILE"
  else
    print_error "Failed to export game (HTTP $HTTP_CODE)"
    echo "$BODY"
    exit 1
  fi
}

# Command: game-import
cmd_game_import() {
  # Note: This command does not require authentication token
  # It runs locally and imports into local databases
  
  # Validate required parameters
  if [ -z "$IMPORT_FILE" ]; then
    print_error "Import file is required"
    print_info "Usage: ./internal-api.sh game-import --file <path> [--wallet <address>]"
    exit 1
  fi
  
  if [ ! -f "$IMPORT_FILE" ]; then
    print_error "File not found: $IMPORT_FILE"
    exit 1
  fi
  
  print_info "Importing game from: $IMPORT_FILE"
  print_info "Wallet address: $WALLET_ADDRESS"
  echo ""
  
  # Build and run the import script
  print_info "Building import script..."
  npm run build > /dev/null 2>&1
  
  if [ $? -ne 0 ]; then
    print_error "Build failed"
    exit 1
  fi
  
  # Run the import script
  node ./dist/scripts/import-game.js --file "$IMPORT_FILE" --wallet "$WALLET_ADDRESS"
}

# Parse arguments
COMMAND=""
GAME_ID=""
VERSION=""
ARTIFACTS="false"
OUTPUT_DIR="data/exports"
IMPORT_FILE=""
WALLET_ADDRESS="local"

while [[ $# -gt 0 ]]; do
  case $1 in
    cleanup|heap-snapshot|memory-stats|db-stats|game-export|game-import|help)
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
    --game-id)
      GAME_ID="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --artifacts)
      ARTIFACTS="true"
      shift
      ;;
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --file)
      IMPORT_FILE="$2"
      shift 2
      ;;
    --wallet)
      WALLET_ADDRESS="$2"
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
  memory-stats)
    cmd_memory_stats
    ;;
  db-stats)
    cmd_db_stats
    ;;
  game-export)
    cmd_game_export
    ;;
  game-import)
    cmd_game_import
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
