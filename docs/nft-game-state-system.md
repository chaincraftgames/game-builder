# NFT Game State System Design

**Version:** 1.0  
**Date:** February 16, 2026  
**Status:** Design Phase

## Overview

The NFT Game State System enables games to extract arbitrary game state data into blockchain-based NFTs and import NFT data to initialize game state. This is a **core value proposition** for ChainCraft's web3 appeal, enabling tradable game assets and integration with token duels.

## Vision & Goals

### Primary Objectives
1. **Web3 Integration**: NFTs as first-class citizens in the game ecosystem
2. **Trading & Staking**: Enable player-to-player NFT trading and staking in token duels
3. **Cross-Game Assets**: Support importing NFTs from one game into another (where compatible)
4. **Flexible System**: Not limited to "character" use case - any game state can become an NFT

### Key Principles
- **Design-Driven**: Creator + AI determine extractable/importable fields during design conversation
- **Standard Compliance**: ERC-721 with IPFS metadata storage
- **Strict Initial Validation**: Start with exact schema matching, iterate to transformation rules
- **Clear Separation**: game-builder handles extraction/validation; blockchain service handles minting

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                             │
│  - Player triggers extraction after game end                │
│  - Player selects NFT to import at game start              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Orchestrator                           │
│  - Calls game-builder extraction endpoint                   │
│  - Passes extracted data to blockchain service              │
│  - Validates NFT ownership before import                    │
│  - Calls game-builder import endpoint with NFT metadata     │
└─────────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
┌──────────────────┐              ┌──────────────────────┐
│  game-builder    │              │  Blockchain Service  │
│  - Extract data  │              │  - Mint NFTs         │
│  - Validate      │              │  - IPFS upload       │
│  - Import data   │              │  - Ownership verify  │
└──────────────────┘              └──────────────────────┘
```

### Responsibilities

#### game-builder (This Service)
**In Scope:**
- Design Phase: Extract/import field declaration during AI conversation
- Spec Processing: Store extraction/import schemas in processed spec
- Extraction API: Return filtered game state data
- Import API: Validate and inject NFT metadata into player state initialization
- Schema Versioning: Track schema versions for compatibility

**Out of Scope:**
- Wallet connection/authentication
- Blockchain transactions
- Gas payment
- IPFS upload
- NFT contract interaction
- Ownership verification

#### Orchestrator
- Session management
- Calls game-builder extraction/import endpoints
- Routes to blockchain service for minting
- Validates wallet ownership before import

#### Blockchain Service (Future/Separate)
- NFT minting on Ethereum mainnet
- IPFS metadata upload
- Contract interaction
- Ownership verification

## Design Phase: Field Declaration

### AI Conversation Integration

During game design, the AI agent asks creators:

**Example Dialog:**
```
AI: "This game includes character progression. Would you like players to 
     be able to save their characters as NFTs that can be traded or used 
     in other games?"

Creator: "Yes"

AI: "Which aspects of your character should be saved? Based on your player 
     state schema, I suggest:
     - name (string)
     - backstory (string) 
     - appearance (string)
     - personality_traits (array)
     
     Should any of these be excluded, or are there additional fields?"

Creator: "That looks good"

AI: "Should these fields be able to change during gameplay?"

Creator: "backstory should be appendable as the character evolves"
```

### Schema Declaration Format

```typescript
{
  nftConfiguration: {
    extractableFields: {
      description: "Fields that can be extracted into NFT metadata",
      source: "playerState", // or "gameState", "sessionState"
      fields: [
        {
          name: "name",
          type: "string",
          mutable: false,
          description: "Character name"
        },
        {
          name: "backstory", 
          type: "string",
          mutable: true,
          mutationType: "append", // or "replace"
          description: "Character backstory and history"
        },
        {
          name: "appearance",
          type: "string", 
          mutable: false
        },
        {
          name: "personality_traits",
          type: "array",
          items: { type: "string" },
          mutable: true,
          mutationType: "append"
        }
      ]
    },
    
    importableFields: {
      description: "Schema for NFTs that can initialize player state",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          backstory: { type: "string" },
          appearance: { type: "string" },
          personality_traits: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["name"]
      }
    },
    
    schemaVersion: "1.0.0",
    compatibility: {
      mode: "strict", // Phase 0: exact match required
      // Future: "flexible", "registry", "mapping"
    }
  }
}
```

## API Specifications

### Extraction Endpoint

```typescript
POST /api/simulate/{sessionId}/extract

Response:
{
  success: true,
  data: {
    extractedFields: {
      name: "Aria Shadowblade",
      backstory: "Orphaned as a child. Joined Thieves Guild at age 15...",
      appearance: "Raven-haired rogue with piercing green eyes",
      personality_traits: ["brave", "cunning", "loyal"]
    },
    metadata: {
      sessionId: "101771105372902",
      gameId: "dc0d36e5-2892-4a96-811e-85d0155fb007",
      gameTitle: "Shadow Realms RPG",
      extractedAt: "2026-02-16T15:30:00Z",
      schemaVersion: "1.0.0"
    }
  }
}

// This data is passed to blockchain service for minting
```

### Import Endpoint

```typescript
POST /api/simulate/{sessionId}/import

Body:
{
  nftMetadata: {
    name: "Aria Shadowblade",
    backstory: "Orphaned as a child...",
    appearance: "Raven-haired rogue...",
    personality_traits: ["brave", "cunning", "loyal"]
  },
  nftContract: "0x...",
  tokenId: "1234"
}

Response (Success):
{
  success: true,
  message: "NFT data validated and will be used to initialize player state"
}

Response (Validation Error):
{
  success: false,
  error: "SCHEMA_MISMATCH",
  details: {
    missing: ["appearance"],
    extra: ["alignment"],
    typeMismatch: {
      "personality_traits": "expected array, got string"
    }
  }
}
```

## Blockchain & Storage

### Standards & Platforms
- **Blockchain**: Ethereum Mainnet (established, composable, high value NFTs)
- **Token Standard**: ERC-721 (NFT standard)
- **Metadata Storage**: IPFS (decentralized, immutable)
- **Metadata Format**: JSON conforming to OpenSea metadata standard

### NFT Metadata Structure

```json
{
  "name": "Shadow Realms Character: Aria Shadowblade",
  "description": "A character from Shadow Realms RPG",
  "image": "ipfs://QmX...",
  "external_url": "https://chaincraft.app/nft/...",
  "attributes": [
    {
      "trait_type": "Game",
      "value": "Shadow Realms RPG"
    },
    {
      "trait_type": "Game ID", 
      "value": "dc0d36e5-2892-4a96-811e-85d0155fb007"
    },
    {
      "trait_type": "Created",
      "value": "2026-02-16"
    }
  ],
  "chaincraft": {
    "schemaVersion": "1.0.0",
    "gameState": {
      "name": "Aria Shadowblade",
      "backstory": "Orphaned as a child. Joined Thieves Guild at age 15...",
      "appearance": "Raven-haired rogue with piercing green eyes",
      "personality_traits": ["brave", "cunning", "loyal"]
    }
  }
}
```

## Phase 0 Implementation Plan

### Implementation Scope

**Phase 0 Goal:** Prove the extraction/import flow with strict schema matching, DB storage for testing, NFT minting deferred to blockchain service.

### Step 1: Design Agent Enhancement
- [ ] Add NFT configuration prompts to design conversation flow
- [ ] AI suggests extractable fields based on player state schema
- [ ] Creator confirms/modifies field selection
- [ ] Store configuration in design specification

### Step 2: Spec Processing Enhancement  
- [ ] Add `nftConfiguration` extraction to spec processing graph
- [ ] Validate extractable fields exist in player state schema
- [ ] Generate Zod schema for importable fields
- [ ] Store in processed spec metadata

### Step 3: Extraction Endpoint
```typescript
// game-builder/src/modules/simulate/simulate.routes.ts

app.post('/api/simulate/:sessionId/extract', async (c) => {
  const { sessionId } = c.req.param()
  
  // 1. Get final checkpoint from LangGraph
  const checkpoint = await getCheckpoint(sessionId)
  
  // 2. Get processed spec with nftConfiguration
  const spec = await getProcessedSpec(gameId)
  
  // 3. Extract configured fields from player state
  const extractedData = extractFields(
    checkpoint.playerState,
    spec.nftConfiguration.extractableFields
  )
  
  // 4. Return data for blockchain service
  return c.json({
    success: true,
    data: {
      extractedFields: extractedData,
      metadata: {
        sessionId,
        gameId,
        gameTitle: spec.title,
        extractedAt: new Date().toISOString(),
        schemaVersion: spec.nftConfiguration.schemaVersion
      }
    }
  })
})
```

### Step 4: Import Validation Endpoint
```typescript
// game-builder/src/modules/simulate/simulate.routes.ts

app.post('/api/simulate/:sessionId/import', async (c) => {
  const { nftMetadata } = await c.req.json()
  const { sessionId } = c.req.param()
  
  // 1. Get processed spec
  const spec = await getProcessedSpec(gameId)
  
  // 2. Validate against importable schema (Zod)
  const validation = spec.nftConfiguration.importableSchema.safeParse(nftMetadata)
  
  if (!validation.success) {
    return c.json({
      success: false,
      error: 'SCHEMA_MISMATCH',
      details: formatZodErrors(validation.error)
    }, 400)
  }
  
  // 3. Store for use in player state initialization
  await storeImportedNftData(sessionId, validation.data)
  
  return c.json({ success: true })
})
```

### Step 5: Player State Initialization Integration
```typescript
// When initializing player in simulation graph

async function initializePlayer(playerId: string, sessionId: string) {
  // Check if player has imported NFT data
  const importedData = await getImportedNftData(sessionId, playerId)
  
  if (importedData) {
    // Merge imported data with default player state
    return {
      ...defaultPlayerState,
      ...importedData
    }
  }
  
  return defaultPlayerState
}
```

### Step 6: Testing & Validation
- [ ] Create test game with extractable character fields
- [ ] Test extraction endpoint returns correct data
- [ ] Test import validation (success and error cases)
- [ ] Test player initialization with imported data
- [ ] Verify strict schema matching works correctly

## Future Enhancements

### Phase 1: NFT Minting Integration
- Orchestrator → Blockchain Service integration
- Wallet ownership verification
- Transaction status tracking
- User notification when NFT is minted

### Phase 2: Cross-Game Compatibility
- Schema mapping rules (e.g., "race" → "characterClass")
- AI-assisted field transformation
- Compatibility registry (games declare what they accept)
- Partial import support (use defaults for missing fields)

### Phase 3: Advanced Features
- Multi-field extraction (e.g., character + inventory)
- Composite NFTs (bundled assets)
- Dynamic NFT updates (on-chain state changes)
- Achievement/milestone NFTs
- Game collections (sets of related NFTs)

### Phase 4: Schema Versioning
- Handle schema evolution over time
- Migration tools for existing NFTs
- Backward compatibility rules
- Version negotiation during import

## Open Questions

### 1. Mutable Field Handling
**Question:** For fields marked as `mutable: true` (e.g., backstory), how do we handle updates?

**Options:**
- **Option A**: Extract final state only (simplest, Phase 0)
- **Option B**: Track delta/history in separate array field
- **Option C**: Append-only string fields (e.g., backstory += new entry)

**Decision:** Phase 0 uses Option A. Investigate Option B for Phase 2.

### 2. Extraction Trigger
**Question:** When should extraction occur?

**Options:**
- **Automatic**: At game end (every game creates NFT)
- **Player-triggered**: Optional "Save as NFT" button
- **Milestone-based**: Only when certain conditions met

**Decision:** Player-triggered. Gives players agency and reduces unnecessary NFTs.

### 3. Import Timing
**Question:** When can players import NFTs?

**Options:**
- **Game Start Only**: Must choose before game begins
- **Any Time**: Can import mid-game (complex state merging)
- **Checkpoint Gates**: Specific phases where import is allowed

**Decision:** Phase 0 = Game Start Only. Evaluate mid-game import in Phase 3.

### 4. Multiple NFT Import
**Question:** Can a player import multiple NFTs? (e.g., character + equipment)

**Decision:** Phase 0 = Single NFT import. Phase 3 = Composite support.

## Security Considerations

### Ownership Verification
- Orchestrator MUST verify wallet owns NFT before calling import endpoint
- game-builder trusts orchestrator's verification
- Include ownership proof in audit logs

### Schema Injection
- All NFT metadata validated against Zod schema
- Reject extra fields not in schema (strict mode)
- Sanitize string fields to prevent XSS

### State Manipulation
- Extracted data is read-only snapshot
- Import only initializes state, doesn't override mid-game
- Audit log all extraction and import events

## Success Metrics

### Phase 0
- ✅ 100% of extraction requests return valid data
- ✅ 0% false positives on schema validation
- ✅ Import initializes player state correctly
- ✅ Cross-game import fails gracefully with clear errors

### Phase 1+
- % of players who extract NFTs after completing games
- % of NFTs traded on secondary market
- Number of cross-game NFT imports
- Creator satisfaction with NFT configuration UX

## References

- [ERC-721 Standard](https://eips.ethereum.org/EIPS/eip-721)
- [OpenSea Metadata Standards](https://docs.opensea.io/docs/metadata-standards)
- [IPFS Documentation](https://docs.ipfs.tech/)
- [Zod Schema Validation](https://zod.dev/)

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-16 | Initial | Design document created from architecture discussion |
