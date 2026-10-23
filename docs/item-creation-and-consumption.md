# Game Item Creation and Consumption

## Overview

Game Builder supports two complementary flows for persistent game items:

- **Item creation (minting):** After a game session, a player can produce a token that captures game state (e.g., a character, an achievement) and optionally generates an image for it.
- **Item consumption:** When starting or playing a game, a player can select a previously created item and provide it as input to the game (e.g., reusing a character across matches).

These flows are designed so that the game logic itself is unaware of whether player input came from a selected item or was typed manually. Item selection is a frontend concern; from the game's perspective, it receives an action string.

---

## Item Creation (Minting)

### Design-Time Configuration

During game design, the design agent can define **produced tokens** — items that the game creates as output. The spec processor extracts this into a `ProducedTokensArtifact` that describes both the token's contents and where it can be used:

```typescript
{
  tokens: [
    {
      tokenType: "character",           // Identifier for this token category
      description: "A superhero character",
      tokenSource: "player",            // Extract fields from player state ("player" | "game")
      fields: ["characterDescription", "characterName", "matchesWon"],
      actionId: "describe-character",   // Labels this token's action context (stored in metadata)
      consumableIn: {                   // Where this token can be used as input (optional)
        phase: "describe_character",    // Player phase that accepts this token
        actionField: "characterDescription"  // Token field to use as the action string
      }
    }
  ]
}
```

This is a **unified artifact** — it tells the system both which fields to snapshot from game state when producing a token, and in which phase the token can substitute for player input. The spec processor extracts this as a single concept because the designer already knows both sides: "players create a character by describing it, and that character can be reused in future matches."

### Runtime Flow

```
Game ends → Player wins
    ↓
Frontend calls POST /api/tokens/prepare
    { sessionId, tokenType: "character", playerId }
    ↓
Orchestrator extracts token data from game state,
generates image, returns token preview
    ↓
Frontend calls POST /api/tokens/mint
    { sessionId, tokenType: "character", playerId }
    ↓
Orchestrator uploads metadata to IPFS (via thirdweb),
mints ERC721 on Game Asset contract (CCGADiamond),
persists token in off-chain DB
    ↓
Frontend tracks progress via GET /api/tokens/progress/:sessionId/:playerId (SSE)
```

### Token Persistence

Token persistence is fully implemented across the stack using a hybrid approach: tokens are stored off-chain in the orchestrator's database and minted on-chain as ERC721 NFTs via the Game Asset contract (CCGADiamond) on Arbitrum Sepolia.

#### Storage

The orchestrator persists tokens in Supabase via `SessionTokenRepository` (`session_tokens` table):

```
session_tokens
├── id: string
├── session_id: string
├── player_address: string (wallet address)
├── token_type: string
├── token_id: number | null              (on-chain ERC721 token ID)
├── metadata_uri: string | null          (IPFS URI)
├── image_uri: string | null             (IPFS URI)
├── image_https_url: string | null       (HTTPS gateway URL)
├── metadata_https_url: string | null    (HTTPS gateway URL)
├── transaction_hash: string | null      (blockchain tx hash)
├── preview_token_data: JSONB | null     (extracted game state fields)
├── preview_image_url: string | null
├── created_at: timestamp
└── updated_at: timestamp
```

Unique constraint: `(session_id, player_address, token_type)` — one token per player per session per type.

`SessionTokenRepository` provides `getByPlayer(playerAddress)` for cross-session queries, but this is not yet exposed as an API endpoint (see Orchestrator Changes below).

#### On-Chain Minting

The orchestrator's `GameAssetMintingService` mints tokens as ERC721 NFTs on the Game Asset contract (CCGADiamond on Arbitrum Sepolia). Token metadata (including image) is uploaded to IPFS via thirdweb's IPFS provider and referenced by the token's `tokenURI`.

#### API Endpoints (Orchestrator)

```
POST /api/tokens/prepare                          — Generate token preview (data extraction + image generation)
POST /api/tokens/mint                              — Mint token on-chain via GameAssetMintingService
GET  /api/tokens/status/:sessionId/:playerId/:tokenType — Check if token exists/minted
GET  /api/tokens/progress/:sessionId/:playerId     — SSE stream for minting progress
GET  /api/tokens/types/:sessionId                  — List available token types for a session
```

**Not yet implemented (needed for consumption):**

```
GET  /api/tokens/query                             — Query tokens by player, gameId, tokenType
```

This is the endpoint the frontend will call when it receives an `itemQuery` from the game (see Orchestrator Changes below).

---

## Item Consumption

### Concept

When a game reaches a phase where player input could come from a previously created item, the runtime derives an `itemQuery` and includes it in the player's response state. The frontend uses this to show an item selection widget. The player either picks an item or ignores the widget and types input manually. Either way, the game receives an action string.

`itemQuery` is **never stored in game state** — it's computed on-the-fly by `getRuntimeResponse()` based on the produced tokens configuration and the current phase. Game mechanics code has no knowledge of item consumption.

### The `itemQuery` Field

Derived by `getRuntimeResponse()` and included in `RuntimePlayerState`:

```typescript
RuntimePlayerState {
  actionRequired: boolean,
  actionsAllowed?: boolean | null,
  privateMessage?: string,
  illegalActionCount: number,
  isGameWinner: boolean,
  itemQuery?: {                    // NEW — optional item selection prompt
    type: "game-assets",           // Query type (V1: always "game-assets")
    gameId: string,                // Game design ID to filter items by
    tokenType?: string,            // Optional: filter to a specific token type
    actionField: string,           // Which field in token data to use as the action
    actionId?: string              // Optional: filter to tokens from a specific action context
  }
}
```

### Late Binding via `actionField`

Item consumption uses **late binding** — the token stores structured game data at mint time, and the consuming game specifies at consumption time which field to use as the action.

This is a deliberate design choice over **early binding** (baking a computed `actionText` into the token at mint time). Since tokens are minted as immutable ERC721 NFTs, early binding creates a versioning problem: if the game's action format evolves (e.g., from free text to structured JSON), all previously minted tokens become incompatible. Late binding avoids this by deferring the interpretation of token data to the consuming game. See [Design Rationale: Early vs Late Binding](#design-rationale-early-vs-late-binding) for the full analysis.

**How it works:**

1. The token's `preview_token_data` already stores all configured fields from game state (e.g., `{ characterDescription: "A flying superhero...", characterName: "Photon", matchesWon: 3 }`).
2. When the player enters a phase matching a token's `consumableIn.phase`, the runtime derives an `itemQuery` with the configured `actionField`: `actionField: "characterDescription"`.
3. The frontend reads `token.preview_token_data.data[actionField]` and sends that value as the action string.

The `consumableIn.actionField` on the token config specifies which field becomes the action. The runtime reads this from the token config when deriving `itemQuery` — no game mechanics involvement needed.

### The `actionId`

Each produced token carries an `actionId` — a label identifying the action context in which the token was created. This is defined in the `ProducedTokensArtifact` configuration:

```typescript
{
  tokens: [
    {
      tokenType: "character",
      description: "A superhero character",
      tokenSource: "player",
      fields: ["characterDescription", "characterName", "matchesWon"],
      actionId: "describe-character",   // Labels this token's action context
      consumableIn: {
        phase: "describe_character",
        actionField: "characterDescription"
      }
    }
  ]
}
```

At produce-token time, `actionId` is stored in the token's `preview_token_data.metadata` alongside `gameId` and `tokenType`.

**Purpose of `actionId`:**

- **Querying:** `itemQuery` can filter by `actionId` to show only tokens produced in a compatible action context. A "character" token produced during a "describe-character" action might not be compatible with a "select-loadout" action, even if both use the same `tokenType`.
- **Schema mapping (future):** When actions evolve to structured schemas, `actionId` maps to a registered schema definition. This enables validation and cross-game field mapping.
- **Backward compatibility:** If a game's action format changes, the token config uses a new `actionId`. Tokens with the old `actionId` are naturally filtered out of queries.

For V1 with free-text actions, `actionId` is a simple string label. It becomes essential as action schemas are introduced.

### Frontend Behavior

When the frontend receives a player state with `itemQuery` present:

1. **Query items:** Call `GET /api/tokens/query?playerId={playerId}&gameId={itemQuery.gameId}&tokenType={itemQuery.tokenType}&actionId={itemQuery.actionId}`
2. **Filter:** Only show fully minted tokens where `preview_token_data.data[actionField]` is populated and `image_https_url` exists
3. **Display picker:** Show item images in a selection widget alongside the normal text input
4. **On selection:** Read `token.preview_token_data.data[itemQuery.actionField]` and send it as the action string via `POST /api/session/action`. If the value is an object, `JSON.stringify` it first.
5. **On skip:** Player types input normally — action processed identically

### Game-Side Behavior

The game logic is completely unaware of item consumption. `itemQuery` is never part of game state — it's derived by `getRuntimeResponse()` and only visible to the frontend. The action handler receives an action string regardless of source:

```
Player types: "A flying superhero with laser eyes"
     → action = "A flying superhero with laser eyes"

Player picks minted character:
     → token.preview_token_data.data["characterDescription"] = "A flying superhero with laser eyes"
     → action = "A flying superhero with laser eyes"
```

The action handler processes both identically.

### Runtime Derivation of `itemQuery`

`itemQuery` is **not stored in game state**. It is derived by `getRuntimeResponse()` in the game-builder at response time, based on two inputs:

1. **Current phase:** The player's current phase name (from player state)
2. **Produced tokens config:** The `consumableIn` entries from `ProducedTokensArtifact`

The logic is a simple lookup:

```typescript
// In getRuntimeResponse():
function deriveItemQuery(
  currentPhase: string,
  producedTokens: ProducedTokenConfig[],
  gameId: string
): ItemQuery | undefined {
  const match = producedTokens.find(t => t.consumableIn?.phase === currentPhase);
  if (!match) return undefined;
  return {
    type: "game-assets",
    gameId,
    tokenType: match.tokenType,
    actionField: match.consumableIn.actionField,
    actionId: match.actionId
  };
}
```

**Key properties:**

- **No game state involvement:** `itemQuery` is never set or cleared via mechanics code (stateDelta or TypeScript). The game mechanics are completely unaware of item consumption.
- **Automatic lifecycle:** `itemQuery` appears when the player enters a matching phase and disappears when they leave it. No explicit clearing needed — if `actionRequired` is false or the phase changes, `itemQuery` is simply not emitted.
- **Mechanics-format agnostic:** Works identically whether game mechanics use stateDelta JSON ops, TypeScript code, or any future format. The derivation reads only the phase name and the static token config.
- **Single source of truth:** The `consumableIn` on the produced token config is the only place that defines the production-consumption relationship.

### Design-Time: Unified Artifact Extraction

The spec processor extracts the `ProducedTokensArtifact` as a single concept. The LLM prompt provides domain knowledge that:

1. If a game creates a persistent item (character, achievement, etc.) AND has a phase where the player provides input that corresponds to that item, both sides should be captured in one token config.
2. The `consumableIn.phase` must match an existing player phase name from the instructions artifact.
3. The `consumableIn.actionField` must be one of the token's `fields`.
4. The `gameId` is known at spec-processing time and does not need to be part of the extracted config.
5. Not all produced tokens need a `consumableIn` — a trophy or achievement token may be minted but never consumed as game input.

This replaces the previous approach of extracting production config separately and then trying to infer or inject consumption behavior through game mechanics.

---

## Smart Contract Integration

### Current State: Hybrid (Off-Chain DB + On-Chain ERC721)

Token creation uses the full hybrid approach — off-chain database for fast queries plus on-chain minting for true ownership:

| Component | Status | Implementation |
|-----------|--------|----------------|
| **ERC721 contract** | Deployed | CCGADiamond (Game Asset) on Arbitrum Sepolia — `mintTo(to, tokenURI)`, `mintWithSignature(...)`, `balanceOf(...)` |
| **Metadata on IPFS** | Implemented | thirdweb IPFS provider uploads token metadata (name, description, image, attributes, gameId, tokenType) |
| **Minting service** | Implemented | `GameAssetMintingService` in orchestrator — server-side signer via private key in env |
| **Off-chain DB** | Implemented | Orchestrator stores tokens in Supabase `session_tokens` for fast querying (query endpoint to be added for consumption) |
| **Frontend flow** | Implemented | Prepare → mint → track progress (SSE) |

### Item Consumption: No Additional Contract Work

Item consumption is entirely off-chain. It will use the new `GET /api/tokens/query` endpoint (see Orchestrator Changes) to retrieve previously minted tokens and present them to the player as selectable input. The selected item's data is sent as a plain action string — no contract interaction occurs during consumption.

The existing `game-asset-balance` data source (ERC721 `balanceOf` on Arbitrum Sepolia) is not involved in item consumption. It remains useful for other game mechanics (e.g., "bonus if you own 5+ game assets").

---

## Cross-Game Token Reuse

### Concept

Because tokens store structured game data and the consuming game specifies which field to read via `actionField`, a token minted in one game can potentially be used in a different game — as long as the consuming game can interpret the data in the requested field.

### Same-Game Reuse (V1)

The simplest case: a token minted in Superhero Showdown is reused in another match of Superhero Showdown. The `itemQuery` specifies `gameId: "superhero-showdown"` and `actionField: "characterDescription"`, the query returns tokens from that game, and the frontend reads `preview_token_data.data.characterDescription` as the action string. No mapping needed.

### Cross-Game Reuse (Future)

With structured action schemas, a token from Game A could be used in Game B if Game B's action schema overlaps with Game A's token data. Combined with `actionId` and schema registration, this enables:

```
Token from Game A (actionId: "describe-character"):
  preview_token_data.data = {
    characterName: "Photon",
    power: "laser eyes",
    armor: "titanium"
  }

Game B's itemQuery:
  actionField: "characterSheet"   (doesn't exist in Game A's token)

Schema mapping (defined at design time, keyed by actionId):
  Game A "describe-character" → Game B "select-character":
    characterSheet.name ← characterName
    characterSheet.ability ← power
    (armor is ignored — Game B doesn't use it)

Result:
  action = '{"name": "Photon", "ability": "laser eyes"}'
```

This is a future concern. For V1, tokens are only reusable within the same game — the `consumableIn` on the produced token config handles this automatically. The `itemQuery.gameId` filter ensures only compatible tokens are shown.

### Extension: `externalTokenSources` (Future)

For cross-game consumption, the unified artifact extends naturally with an `externalTokenSources` array:

```typescript
{
  producedTokens: [/* ... same-game tokens with consumableIn ... */],

  externalTokenSources: [
    {
      phase: "select_character",        // Phase in THIS game that accepts external tokens
      sourceGameId: "game-a",           // Game that produced the tokens
      sourceTokenType: "character",     // Token type to query
      actionField: "characterDescription",
      actionId: "describe-character"    // Optional: filter by action context
    }
  ]
}
```

`getRuntimeResponse()` checks both `producedTokens[].consumableIn` and `externalTokenSources[]` when deriving `itemQuery`. The runtime behavior, frontend, and orchestrator are identical — only the source of the config differs.

Key design decision: the late-binding `actionField` approach makes cross-game reuse cleaner than early-binding would have. The mapping layer reads the token's structured data and produces the value the consuming game expects for `actionField`. No need to parse or reverse-engineer a baked-in action string.

---

## Migration Path: Free Text to Action Schemas

### Current State (V1): Free Text Actions

Today, game actions are plain text strings: `"A flying superhero called Photon with laser eyes"`. The `actionField` in `itemQuery` points to a token data field that contains this plain text value. This works directly — the frontend reads the string and sends it as the action.

### Future State: Structured Action Schemas

As games mature, actions will evolve to structured objects with defined schemas:

```json
{
  "characterName": "Photon",
  "power": "laser eyes",
  "armor": "titanium",
  "backstory": "Former scientist..."
}
```

Games will define action schemas (potentially using JSON Schema), and the frontend may render schema-driven input forms (e.g., via react-jsonschema-form) instead of a plain text box.

### How `actionField` Adapts

The `actionField` approach handles this transition naturally because `preview_token_data` is JSONB — the value at `data[actionField]` can be a string or an object:

1. **String values (V1):** `token.preview_token_data.data["characterDescription"]` → `"A flying superhero..."` → sent as-is.
2. **Object values (future):** `token.preview_token_data.data["characterSheet"]` → `{ name: "Photon", power: "laser eyes" }` → `JSON.stringify`'d and sent as the action string.
3. **Schema validation (future):** The `actionId` maps to a registered schema. The frontend validates the token's data against the consuming game's expected schema before allowing selection.

### How `actionId` Enables Schema Evolution

When a game's action format changes:

1. **New `actionId`:** The updated game emits `actionId: "describe-character-v2"` in its `itemQuery`.
2. **Old tokens filtered out:** Tokens with `actionId: "describe-character"` don't match the query and aren't shown.
3. **Migration path:** A schema mapping can be registered that transforms `describe-character` data into `describe-character-v2` format, preserving backward compatibility for old tokens.
4. **No token updates needed:** The immutable on-chain tokens are untouched — the mapping layer handles the translation.

This mirrors how API versioning works — new versions get new identifiers, old versions are supported via adapters.

---

## Example: Superhero Showdown

### Game Design

A 2-player game where each player describes a superhero character. Characters face off in battle rounds. The winner can mint their character.

### Produced Tokens Config

```json
{
  "tokens": [{
    "tokenType": "character",
    "description": "A superhero character with powers and backstory",
    "tokenSource": "player",
    "fields": ["characterDescription", "characterName", "matchesWon"],
    "actionId": "describe-character",
    "consumableIn": {
      "phase": "describe_character",
      "actionField": "characterDescription"
    }
  }]
}
```

### Match Flow (Creation)

1. Player describes character: action = `"A flying superhero called Photon with laser eyes and titanium armor"`
2. Game stores in `players.player1.characterDescription`
3. Battle rounds proceed, player wins
4. Frontend calls `POST /api/tokens/prepare { sessionId, tokenType: "character", playerId: "player1" }` → gets token preview with image
5. Frontend calls `POST /api/tokens/mint { sessionId, tokenType: "character", playerId: "player1" }` → mints on-chain ERC721, persists off-chain
6. Frontend tracks progress via `GET /api/tokens/progress/:sessionId/:playerId` (SSE)

### Match Flow (Consumption)

1. Player starts new match of Superhero Showdown
2. Game enters `describe_character` phase, player's `actionRequired` is true
3. `getRuntimeResponse()` checks produced token config → `consumableIn.phase` matches current phase → derives `itemQuery`:
   ```json
   { "type": "game-assets", "gameId": "superhero-showdown", "tokenType": "character",
     "actionField": "characterDescription", "actionId": "describe-character" }
   ```
4. Frontend receives player state with `itemQuery`, calls `GET /api/tokens/query?playerId=...&gameId=superhero-showdown&tokenType=character&actionId=describe-character`
5. Response: list of previously minted characters with images and structured token data
6. Player picks "Photon" from the picker
7. Frontend reads `token.preview_token_data.data["characterDescription"]` → `"A flying superhero called Photon with laser eyes and titanium armor"`
8. Frontend sends this as the action string
9. Game processes it exactly as if the player had typed it — no knowledge of item selection
10. Phase advances → `itemQuery` is no longer derived → picker disappears on next poll

---

## Frontend Changes (chaincraft-frontend)

Item consumption requires changes to types, a new API proxy route, a new UI component, and integration into the existing game session flow.

### 1. Add `itemQuery` to `PlayerState` Type

**File:** `src/types/simulation.ts`

The current `PlayerState` interface:

```typescript
export interface PlayerState {
  illegalActionCount: number;
  privateMessage?: string;
  actionsAllowed: boolean;
  actionRequired: boolean;
  isGameWinner: boolean;
}
```

Add `itemQuery`:

```typescript
export interface ItemQuery {
  type: "game-assets";
  gameId: string;
  tokenType?: string;
  actionField: string;
  actionId?: string;
}

export interface PlayerState {
  illegalActionCount: number;
  privateMessage?: string;
  actionsAllowed: boolean;
  actionRequired: boolean;
  isGameWinner: boolean;
  itemQuery?: ItemQuery;
}
```

No other type changes needed — `SimulationResponse.playerStates` already uses `Record<string, PlayerState>`, so `itemQuery` flows through automatically when the orchestrator returns it.

### 2. Add Token Query API Proxy Route

**New file:** `src/app/api/tokens/query/route.ts`

Follows the same proxy pattern as the existing token routes (`prepare`, `mint`, `status`, etc.):

```typescript
// GET /api/tokens/query?playerId=...&gameId=...&tokenType=...
export async function GET(request: NextRequest) {
  const sessionAddress = await getSessionAddress(request);
  if (!sessionAddress) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Forward query params to orchestrator
  const searchParams = request.nextUrl.searchParams;
  const queryString = searchParams.toString();

  const data = await orchestratorFetchJson(
    request,
    `/api/tokens/query?${queryString}`,
    { method: "GET" }
  );

  return NextResponse.json(data);
}
```

Auth is required so the orchestrator can verify the caller has access to the requested player's tokens.

### 3. Item Picker Component

**New file:** `src/components/simulation/ItemPicker.tsx`

Displayed alongside the text input when `itemQuery` is present on the connected player's state.

```
┌─────────────────────────────────────────────────┐
│  Select a character or describe a new one:       │
│                                                   │
│  ┌────────┐  ┌────────┐  ┌────────┐             │
│  │  img   │  │  img   │  │  img   │             │
│  │ Photon │  │ Blaze  │  │ Frost  │             │
│  └────────┘  └────────┘  └────────┘             │
│                                                   │
│  [Type your own description here...    ] [Send]   │
└─────────────────────────────────────────────────┘
```

Key behaviors:
- Fetches items from `GET /api/tokens/query` on mount when `itemQuery` is present
- Filters to items where `preview_token_data.data[actionField]` is populated and an image URL exists
- Displays item images in a horizontal scrollable strip or grid
- Clicking an item reads `token.preview_token_data.data[itemQuery.actionField]`, `JSON.stringify`s it if it's an object, and calls `handleAction` with the result
- The normal text input remains available — the picker is additive, not a replacement
- If no items match, the picker is hidden (player must type input)
- Loading and empty states handled gracefully

### 4. Integration into SimulationChat

**File:** `src/components/simulation/SimulationChat.tsx`

This is the main game chat UI. It currently renders the message history and a text input with submit. Changes:

1. Receive `itemQuery` from player state (via `SessionContext`)
2. When `itemQuery` is present on the connected player and `actionRequired` is true, render `<ItemPicker>` above the text input
3. When `itemQuery` is absent, render normally (no picker)

The action submission path is unchanged — `handleAction(actionText)` in `MessagesContext` is called whether the action came from the picker or the text input.

### 5. SessionContext Changes

**File:** `src/contexts/simulation/SessionContext.tsx`

Currently polls `GET /api/session/state` every 5 seconds and exposes `playerStates`. Changes:

- The `itemQuery` field is already part of `playerStates` (once the type is updated) — no additional fetching needed
- Optionally, expose a convenience accessor: `connectedPlayerItemQuery` that extracts `playerStates[connectedPlayer]?.itemQuery`

### 6. Data Flow Summary

```
SessionContext polls /api/session/state
    → playerStates includes itemQuery (derived by getRuntimeResponse from token config + current phase)
    ↓
SimulationChat detects itemQuery + actionRequired
    → Renders <ItemPicker itemQuery={itemQuery} />
    ↓
ItemPicker calls GET /api/tokens/query?playerId=...&gameId=...&tokenType=...&actionId=...
    → Receives list of tokens with images and structured data
    → Displays selectable items
    ↓
Player clicks item (or types manually)
    → handleAction(token.preview_token_data.data[itemQuery.actionField])
    ↓
Existing action flow: POST /api/session/action → orchestrator → game-builder
    → Game receives action string, processes normally
    → Phase advances, actionRequired goes false
    ↓
Next state poll: itemQuery no longer derived → picker disappears
```

---

## Orchestrator Changes (chaincraft-orchestrator)

### 1. New `GET /api/tokens/query` Endpoint

**File:** `src/modules/tokens/token-routes.ts`

The `SessionTokenRepository` already has `getByPlayer(playerAddress)` which returns all tokens minted by a player across sessions. A new route needs to expose this with filtering.

**Endpoint:** `GET /api/tokens/query`

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `playerId` | Yes | Wallet address of the player |
| `gameId` | No | Filter to tokens from a specific game design |
| `tokenType` | No | Filter to a specific token type |
| `actionId` | No | Filter to tokens from a specific action context |

**Response:**

```typescript
{
  tokens: Array<{
    id: string;
    session_id: string;
    player_address: string;
    token_type: string;
    token_id: number | null;
    image_https_url: string | null;
    preview_token_data: Record<string, unknown> | null;
    metadata_https_url: string | null;
    created_at: string;
  }>
}
```

**Implementation notes:**
- Requires auth via `requireAuth` middleware (consistent with other token routes)
- The caller's wallet address should match `playerId`, or the endpoint should scope results to the authenticated user's address
- `gameId` filtering: `preview_token_data` contains `metadata.gameId` from the produce-token step. Filtering requires a JSONB query on `preview_token_data->'metadata'->>'gameId'` or the addition of a `game_id` column to `session_tokens`
- `actionId` filtering: `preview_token_data` contains `metadata.actionId`. Same JSONB query approach as `gameId`.
- Only return fully minted tokens (where `transaction_hash` is not null) to avoid showing in-progress mints
- The frontend filters client-side for tokens where `preview_token_data.data[actionField]` is populated (since `actionField` depends on the consuming game's `itemQuery`, not a fixed column)

**Schema consideration:** The current `session_tokens` table does not have top-level `game_id` or `action_id` columns. Both values are nested inside `preview_token_data.metadata`. Options:
1. **JSONB query** — filter using Supabase's `.filter('preview_token_data->metadata->>gameId', 'eq', gameId)`. Works but requires the field to be reliably populated.
2. **Add `game_id` and `action_id` columns** — denormalize for efficient indexing. Populate during the `upsert` in the prepare step. Preferred if query volume grows.

For V1, the JSONB query approach is sufficient for both `gameId` and `actionId`.

### 2. `RuntimePlayerState` Passthrough

The orchestrator's simulate service returns `RuntimePlayerState` from the game-builder to the frontend. The `itemQuery` field is derived by the game-builder's `getRuntimeResponse()` based on the current phase and produced token config.

**File:** `src/modules/sessions/simulate.routes.ts`

Current `RuntimePlayerState` type in the orchestrator:

```typescript
interface RuntimePlayerState {
  illegalActionCount: number;
  privateMessage?: string;
  actionsAllowed: boolean;
  actionRequired: boolean;
  isGameWinner: boolean;
}
```

Add `itemQuery`:

```typescript
interface ItemQuery {
  type: "game-assets";
  gameId: string;
  tokenType?: string;
  actionField: string;
  actionId?: string;
}

interface RuntimePlayerState {
  illegalActionCount: number;
  privateMessage?: string;
  actionsAllowed: boolean;
  actionRequired: boolean;
  isGameWinner: boolean;
  itemQuery?: ItemQuery;
}
```

The orchestrator does not need to interpret `itemQuery` — it passes through from game-builder to frontend. But the type should be updated so the field isn't stripped by any serialization or validation layer.

**Verify:** Check whether the simulate service or routes selectively pick fields from the game-builder response (e.g., destructuring only known fields). If so, `itemQuery` must be included in the passthrough. If the response is forwarded as-is, no code change is needed — only the type annotation.

### 3. `SessionTokenRepository` Enhancements

**File:** `src/infrastructure/db/repositories/session-token.ts`

The existing `getByPlayer(playerAddress)` returns all tokens for a player. Add a filtered query method:

```typescript
async queryTokens(filters: {
  playerAddress: string;
  gameId?: string;
  tokenType?: string;
  actionId?: string;
  mintedOnly?: boolean;
}): Promise<SessionToken[]> {
  let query = this.supabase
    .from("session_tokens")
    .select("*")
    .eq("player_address", filters.playerAddress);

  if (filters.mintedOnly) {
    query = query.not("transaction_hash", "is", null);
  }
  if (filters.gameId) {
    query = query.filter("preview_token_data->metadata->>gameId", "eq", filters.gameId);
  }
  if (filters.tokenType) {
    query = query.eq("token_type", filters.tokenType);
  }
  if (filters.actionId) {
    query = query.filter("preview_token_data->metadata->>actionId", "eq", filters.actionId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
```

### 4. No Changes to Action Submission

The existing `POST /api/simulate/action` endpoint accepts `{ gameId, playerId, action }` where `action` is an arbitrary string. No modification is needed — item-sourced actions and typed actions are identical from the orchestrator's perspective.

---

## Implementation Scope

### Phase 1: Token Persistence + On-Chain Minting ✅

- [x] Off-chain token storage in Supabase (`session_tokens` table + `SessionTokenRepository`)
- [x] `POST /api/tokens/prepare` endpoint (data extraction + image generation)
- [x] `POST /api/tokens/mint` endpoint (on-chain ERC721 mint + off-chain persist)
- [x] `GET /api/tokens/status` and `GET /api/tokens/progress` endpoints
- [x] `GET /api/tokens/types/:sessionId` endpoint
- [x] ERC721 Game Asset contract (CCGADiamond) deployed on Arbitrum Sepolia
- [x] IPFS metadata upload via thirdweb
- [x] `GameAssetMintingService` with server-side signer
- [x] Frontend: prepare → mint → track progress flow

### Phase 2: Item Consumption

**Game-builder:**
- [ ] Add `actionId` and `consumableIn` (phase + actionField) to `ProducedTokenConfigurationSchema`
- [ ] Update spec processor prompts/domain knowledge: extract unified token config (production + consumption in one artifact)
- [ ] Update `produceToken` to store `actionId` in `preview_token_data.metadata`
- [ ] Add `itemQuery` to `RuntimePlayerState` type
- [ ] Implement `itemQuery` derivation in `getRuntimeResponse()`: match current phase against `consumableIn.phase` in token config
- [ ] Ensure produced tokens config is accessible to `getRuntimeResponse()` (loaded from game spec or checkpoint)

**Orchestrator:**
- [ ] Add `queryTokens()` method to `SessionTokenRepository` (filter by gameId, tokenType, actionId via JSONB queries)
- [ ] Add `GET /api/tokens/query` route in `token-routes.ts`
- [ ] Update `RuntimePlayerState` type to include `itemQuery` with `actionField` and `actionId` (passthrough)
- [ ] Verify simulate service doesn't strip unknown fields from player state

**Frontend:**
- [ ] Add `ItemQuery` (with `actionField`, `actionId`) and update `PlayerState` type in `src/types/simulation.ts`
- [ ] Add `GET /api/tokens/query` proxy route in `src/app/api/tokens/query/route.ts`
- [ ] Build `ItemPicker` component (`src/components/simulation/ItemPicker.tsx`)
- [ ] Integrate `ItemPicker` into `SimulationChat.tsx` (show when `itemQuery` + `actionRequired`)
- [ ] Wire item selection to `handleAction(token.preview_token_data.data[itemQuery.actionField])`
