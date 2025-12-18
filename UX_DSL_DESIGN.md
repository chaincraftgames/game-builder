# UX DSL Design Document

## Overview

This document describes the UX DSL (User Experience Domain-Specific Language) architecture for ChainCraft game generation. The UX DSL serves as a bridge between game specifications and multiple rendering platforms, enabling a single game to be rendered across form-based, 2D, and 3D interfaces.

## Table of Contents

- [Core Principles](#core-principles)
- [Architecture Overview](#architecture-overview)
- [Component Responsibilities](#component-responsibilities)
- [Data Schemas](#data-schemas)
- [Generation Flow](#generation-flow)
- [Examples](#examples)
- [Validation & Constraints](#validation--constraints)
- [Future Considerations](#future-considerations)

---

## Core Principles

### 1. Separation of Concerns

**UX DSL Contains**:
- Structural elements (gamepiece types, inventories, actions)
- Default visibility rules (can be overridden at runtime)
- Layout hints (suggestions, not requirements)
- Interaction patterns

**UX DSL Does NOT Contain**:
- Game logic or mechanics (lives in Game Spec and SWE-generated code)
- Gamepiece properties or property schemas (determined by game mechanics)
- Individual gamepiece content (lives in Content Manifests)
- Win conditions or scoring algorithms
- Specific rendering details (decided by plugins)

### 2. Runtime Flexibility

The UX DSL specifies **default** behaviors that the game module can override at runtime:

```typescript
// UX DSL says: "Hands are visible to owner" (default)
// Game module can override: "During reveal phase, all hands are public"
```

Game modules provide runtime APIs that plugins query for current state, not static DSL values.

### 3. Single Source of Truth

- **Gamepiece metadata**: Defined once by Content Generator (or Metadata Extractor)
- **UX structure**: Defined by UX Generator using that metadata
- **No duplication**: Components don't define the same information in multiple places

### 4. Plugin Agnostic

The UX DSL describes **what exists and how it's organized**, not **how it's rendered**:
- Form plugin: Renders as dropdowns and buttons
- 2D plugin: Renders as SVG card layouts
- 3D plugin: Renders as 3D card models

All plugins consume the same UX DSL.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GAME GENERATION FLOW                         │
└─────────────────────────────────────────────────────────────────────┘

Phase 1: DESIGN
┌──────────────┐
│ User ←→ AI   │ → Base Game Spec (detailed design document)
└──────────────┘

Phase 2A: METADATA EXTRACTION (Always Runs)
┌──────────────────┐
│ Base Game Spec   │ → Metadata Extractor → gamepiece_metadata (minimal)
└──────────────────┘

Phase 2B: CONTENT GENERATION (Optional - Designer's Choice)
┌─────────────────────────────────┐
│ IF designer invokes tool:       │
│   Base Spec + metadata          │ → Content Generator →
│                                 │    - Expanded metadata
│                                 │    - gamepiece_descriptions (NL)
└─────────────────────────────────┘

Phase 3: UX DISCOVERY
┌──────────────────────────────────┐
│ Base Spec + gamepiece_metadata   │ → UX Generator → UX DSL
└──────────────────────────────────┘

Phase 4: CODE GENERATION
┌──────────────────────────────────────────┐
│ Base Spec + metadata + UX DSL +          │ → SWE Agent → Game Module
│ [gamepiece_descriptions]                 │
└──────────────────────────────────────────┘

Phase 5: PLUGIN GENERATION (Per Platform)
┌──────────────────────────────────────────┐
│ UX DSL + Game Module + [Content]         │ → Plugin Generator → Renderer
└──────────────────────────────────────────┘
```

---

## Component Responsibilities

### Metadata Extractor

**Purpose**: Extract gamepiece type information and create high-level descriptions for each instance.

**Input**: Base Game Spec (natural language)

**Output**: `gamepiece_metadata` with instance-level descriptions

**Responsibilities**:
- Identify gamepiece types mentioned in spec
- Determine quantities (explicit or inferred)
- Assign canonical IDs (type-level and instance-level)
- **Create high-level description for EACH instance** (e.g., "Ace of Spades", "Fire Drake")
- Flag instances that need detailed content expansion
- Recognize standard templates (e.g., "standard 52-card deck")
- Ensure unique instance IDs (prevent duplicates)

**Key Insight**: The extractor creates a **skeleton** for each gamepiece instance. User can review/modify these descriptions before content expansion.

**Example**:
```yaml
# Input: "Rock, Paper, Scissors - best of 3 rounds"
# Output:
gamepiece_metadata:
  - id: rps_choice
    type: piece
    quantity: 3
    description: "Player choice: rock, paper, or scissors"
    instances:
      - id: rock
        name: "Rock"
        brief_description: "The rock choice"
        needs_expansion: false
      - id: paper
        name: "Paper"
        brief_description: "The paper choice"
        needs_expansion: false
      - id: scissors
        name: "Scissors"
        brief_description: "The scissors choice"
        needs_expansion: false
```

### Content Generator (LangGraph Workflow)

**Purpose**: Expand high-level gamepiece descriptions into detailed content with abilities.

**Architecture**: LangGraph workflow with conditional expansion nodes.

**Trigger**: Instance-level flag `needs_expansion: true` in metadata

**Input**: 
- Base Game Spec
- `gamepiece_metadata` (with instance skeletons from extractor)
- Previously generated instances (for consistency/deduplication)

**Output**:
- `gamepiece_descriptions` (NL descriptions of abilities)
- Updated metadata with property schemas

**Workflow**:
```
For each gamepiece instance in metadata:
  ↓
  Check: needs_expansion flag
  ↓
  YES → Content Expansion Node (LLM call with context)
  NO  → Skip (use brief_description as-is)
  ↓
  Aggregation Node (collects all expanded descriptions)
  ↓
  Deduplication Check (ensure no duplicate abilities/names)
  ↓
  User Review (optional - flag conflicts)
```

**Key Features**:
- **Sequential Processing**: Each instance expansion sees previously generated instances
- **Context Passing**: Each LLM call receives full context (spec + previous instances)
- **Deduplication**: Check generated content against existing instances
- **User Intervention**: Designer can modify instance skeletons before expansion
- **Parallelization Option**: Can batch non-conflicting instances

**Example**:
```yaml
# Input metadata (from extractor):
gamepiece_metadata:
  - id: creature_card
    type: card
    quantity: 100
    instances:
      - id: fire_drake
        name: "Fire Drake"
        brief_description: "A dragon that breathes fire"
        needs_expansion: true
      - id: ice_wizard
        name: "Ice Wizard"
        brief_description: "A wizard with ice magic"
        needs_expansion: true
      # ... 98 more

# Output (after Content Generator workflow):
gamepiece_descriptions:
  - id: fire_drake
    gamepiece_type: creature_card
    name: "Fire Drake"
    description: "A fierce dragon breathing flames"
    properties: { attack: 5, defense: 4, mana_cost: 6 }
    abilities: |
      When Fire Drake enters play, deal 2 damage to target creature.
      At the start of your turn, Fire Drake deals 1 damage to each opponent.
      
  - id: ice_wizard
    gamepiece_type: creature_card
    name: "Ice Wizard"
    description: "A master of frost magic"
    properties: { attack: 2, defense: 3, mana_cost: 4 }
    abilities: |
      Tap: Freeze target creature. It cannot attack or block until your next turn.
      Ice Wizard cannot be targeted by fire-based abilities.
    # Note: Different abilities from fire_drake - no duplication
```

### UX Generator

**Purpose**: Generate UX DSL describing game structure and interactions.

**Input**:
- Base Game Spec
- `gamepiece_metadata` (from extractor or Content Generator)

**Output**: UX DSL (JSON/YAML)

**Responsibilities**:
- **MUST** use canonical gamepiece IDs from metadata
- **MUST** use quantities from metadata
- Identify inventories (hands, decks, zones, piles)
- Define actions (movements between inventories)
- Specify default visibility rules
- Provide layout hints

**Constraints**:
- Cannot invent new gamepiece types
- Cannot modify gamepiece quantities
- Cannot change gamepiece IDs
- Must work from provided metadata

**Example**:
```yaml
# Given metadata: playing_card (54 cards)
# Generates:
inventories:
  - id: DECK
    accepts: [playing_card]
    visibility: count_only
    scope: game
  - id: HAND
    accepts: [playing_card]
    visibility: owner
    scope: player
    capacity: { max: 7 }
```

### SWE Agent (Code Generator)

**Purpose**: Generate game module code implementing the game.

**Input**:
- Base Game Spec (rules, mechanics)
- `gamepiece_metadata`
- `gamepiece_descriptions` (if available)
- UX DSL (structure)

**Output**: Game Module (TypeScript code using text-game-engine)

**Responsibilities**:
- Implement game rules and mechanics
- Create ECS components matching gamepiece properties
- Define inventories matching UX DSL
- Implement actions matching UX DSL
- Create visibility override system
- Generate runtime API for plugins

**Example**:
```typescript
// From UX DSL: HAND inventory accepts playing_card
enum InventoryType {
    HAND = 1,
    DECK = 2
}

defineInventoryType(world, InventoryType.HAND, [cardGamepieceTypeId]);

// From gamepiece_descriptions: Fire Drake abilities
function firedrakeEnterPlay(world: World, cardId: number) {
    // Implement: "deal 2 damage to target creature"
}
```

### Plugin Generator

**Purpose**: Generate platform-specific renderer from UX DSL.

**Input**:
- UX DSL
- Game Module (for runtime queries)
- Content Manifests (for visual assets)

**Output**: Renderer Plugin (form/2D/3D)

**Responsibilities**:
- Render inventories according to visibility
- Handle user interactions mapped to actions
- Query game state via runtime API
- Update UI on state changes

**Platforms**:
- **Form Plugin**: Dropdowns, buttons, text displays (high feasibility)
- **2D SVG Plugin**: Vector graphics, drag-and-drop (moderate feasibility)
- **3D Plugin**: 3D models, animations (low feasibility without templates)

---

## Data Schemas

### Gamepiece Metadata (With Instance Skeletons)

Produced by Metadata Extractor, consumed by Content Generator, UX Generator, and SWE.

```yaml
gamepiece_metadata:
  - id: string                      # Type-level canonical ID (REQUIRED)
    type: card|token|piece|dice|tile|board
    quantity: number                # Total instances
    description: string             # Type-level summary
    
    # Instance-level skeletons (REQUIRED - one per quantity)
    instances: Array<{
        id: string                  # Instance-level canonical ID (unique)
        name: string                # Human-readable name
        brief_description: string   # High-level description
        needs_expansion: boolean    # Flag for Content Generator workflow
        
        # Optional hints for expansion
        category?: string           # "common", "rare", "legendary"
        theme?: string              # "fire", "ice", "nature"
        role?: string               # "attacker", "defender", "support"
    }>
    
    # Optional template reference
    template?: string               # "standard_52_deck", "monopoly_pieces"
```

**Key Design Decision**: Every instance gets a skeleton entry, even for simple games. This:
- Prevents duplicates (IDs assigned upfront)
- Allows user review before expansion
- Provides context for Content Generator
- Creates single source of truth for instance list

### Gamepiece Metadata (Expanded)

Produced by Content Generator (optional).

```yaml
gamepiece_metadata:
  - id: string
    type: card|token|piece|dice|tile|board
    quantity: number
    description: string
    
    # Added by Content Generator
    has_unique_abilities: boolean
    properties_schema?: Array<{
        name: string
        type: string
    }>
    content_manifest_ref?: string   # Path to detailed descriptions
```

### Gamepiece Descriptions

Produced by Content Generator, consumed by SWE.

```yaml
gamepiece_descriptions:
  - id: string                      # Instance ID (e.g., "ace_of_spades")
    gamepiece_type: string          # References gamepiece_metadata.id
    name: string
    description: string             # Natural language description
    
    # Optional structured data
    properties?: Record<string, any>
    
    # Natural language ability descriptions
    abilities?: string
    
    # Usage context
    usage?: string
    
    # Visual description for asset generation
    visual_description?: string
```

### UX DSL Schema

Produced by UX Generator, consumed by SWE and Plugin Generators.

```typescript
interface UXManifest {
    game: {
        name: string;
        maxPlayers: number;
        description?: string;
    };
    
    gamepieceTypes: Array<{
        id: string;                 // MUST match gamepiece_metadata.id
        type: 'card' | 'token' | 'piece' | 'dice' | 'tile' | 'board';
        quantity?: number;          // MUST match gamepiece_metadata.quantity
        
        // Generic visual hints (not property-specific)
        visual?: {
            backImage?: string;     // For cards/tiles with hidden sides
            displayMode?: 'detailed' | 'generic' | 'icon';
            icon?: string;
        };
    }>;
    
    inventories: Array<{
        id: string;                 // Maps to InventoryType enum in code
        label: string;              // Human-readable name
        accepts: string[];          // Gamepiece type IDs
        
        // Default visibility (can be overridden at runtime)
        visibility: 'public' | 'owner' | 'hidden' | 'count_only';
        
        scope: 'game' | 'player' | 'team';
        capacity?: {
            min?: number;
            max?: number;
        };
        
        // Layout hint (plugin decides actual rendering)
        layoutHint?: 'stack' | 'spread' | 'grid' | 'fan';
    }>;
    
    actions: Array<{
        id: string;
        label: string;              // Human-readable name
        type: 'move' | 'reveal' | 'shuffle' | 'transform';
        source?: string;            // Inventory ID
        target?: string;            // Inventory ID
        trigger: 'command' | 'click' | 'drag';
        pattern?: string;           // For command triggers (e.g., "draw", "play {n}")
        description?: string;
    }>;
    
    // Optional layout hints for plugins
    layout?: {
        regions: Array<{
            id: string;
            type: 'collection' | 'grid' | 'zone' | 'display';
            binding: string;        // ECS query hint: "player.hand", "game.deck"
            label?: string;
        }>;
    };
}
```

### Game Module Runtime API

Every game module must provide these APIs for plugins:

```typescript
interface GameModuleRuntimeAPI {
    // Visibility queries (can override UX DSL defaults)
    getInventoryVisibility(
        inventoryId: number, 
        requestingPlayerId: number
    ): 'public' | 'owner' | 'hidden' | 'count_only';
    
    getGamepieceVisibility(
        gamepieceId: number,
        requestingPlayerId: number
    ): boolean;  // Can this player see this gamepiece's details?
    
    // State queries
    getInventoryContents(
        ownerId: number,
        inventoryType: string
    ): number[];  // Gamepiece entity IDs
    
    getGamepieceProperties(
        gamepieceId: number
    ): Record<string, any>;  // Dynamic property discovery
    
    // Action execution
    executeAction(
        playerId: number,
        actionId: string,
        parameters?: any
    ): Promise<ActionResult>;
}
```

---

## Generation Flow Details

### Phase 2A: Metadata Extraction

**Input**: Base Game Spec

**Process**:
1. Parse spec for gamepiece type mentions
2. Identify quantities (explicit or inferred)
3. Assign canonical IDs (lowercase, underscores)
4. Detect standard templates
5. Flag types needing content generation
6. Generate minimal metadata structure

**Auto-Flagging Logic**:
```typescript
function shouldFlagForContentGeneration(
    gamepieceType: GamepieceMetadata,
    spec: string
): boolean {
    // High quantity + uniqueness indicators
    if (gamepieceType.quantity > 20) {
        if (spec.match(/unique|different abilities|various effects/i)) {
            return true;
        }
    }
    
    // Explicit complexity indicators
    if (spec.match(/custom cards|special abilities|individual effects/i)) {
        return true;
    }
    
    // Known complex patterns
    if (gamepieceType.quantity > 50 && gamepieceType.type === 'card') {
        return true;
    }
    
    return false;
}
```

**Output**: Minimal gamepiece_metadata

---

### Phase 2A+: Iterative Refinement (Future Enhancement)

**Motivation**: For complex games with large instance counts (e.g., 100+ unique creature cards), single-pass metadata extraction may produce incomplete or low-quality instance enumerations. An optional iterative refinement loop can improve metadata completeness before content expansion.

**Architecture**: Extend Phase 2A subgraph with review and update nodes (feature-flagged, disabled by default)

**Workflow**:
```
plan_metadata → execute_metadata → [review_completeness?] → validate_semantic → diff_metadata
                                           ↓
                                    [complete?]
                                    YES → continue
                                    NO  → plan_updates → execute_metadata (loop)
```

**Key Concepts**:

1. **Review Node**: Scores metadata completeness using deterministic heuristics
   - Calculates: required instances vs. actual quality instances
   - Detects: gaps (missing categories), balance issues (theme distribution), quality issues (generic names, duplicate descriptions)
   - Outputs: numeric score, structured diagnostics, actionable suggestions
   - Implementation: Pure TypeScript (fast, testable, cost-free)

2. **Iteration Control**:
   - Feature flag: `enableMetadataIteration` (default: false)
   - Auto-detect: Enable for games with 30+ total instances
   - Safety limit: Max 5 iterations
   - Exit conditions: Completion score ≥ 95% AND no critical gaps/balance issues

3. **Update Planning**:
   - Simple mode: Format review suggestions as update plan (no LLM)
   - Advanced mode: LLM synthesizes review into nuanced refinement strategy
   - Preserves existing instances, only adds/improves

**Design Goals**:
- **Phase 1 (MVP)**: Simple single-pass extraction for ≤20 instance games
- **Phase 2 (Enhancement)**: Add iterative refinement with backwards compatibility
- **Separation of Concerns**: Metadata iteration produces complete instance lists with brief descriptions; Content Expansion (Phase 2B) adds detailed abilities/stats

**When to Use Iteration**:
- Complex games (100-card decks, 50+ unique tokens)
- Games where spec mentions few specific instances but requires many
- Games requiring thematic balance across categories

**When NOT to Use Iteration**:
- Simple games (RPS, standard playing card deck, basic dice)
- Games using standard templates
- Rapid prototyping where completeness < speed

---

### Phase 2B: Content Expansion (LangGraph Workflow)

**Trigger**: Instance-level `needs_expansion: true` flags in metadata

**Architecture**: LangGraph state machine with conditional nodes

**Workflow Graph**:
```
START
  ↓
[Initialize State]
  - Load base spec
  - Load gamepiece_metadata with instance skeletons
  - Create empty descriptions list
  ↓
[For Each Instance Node] (Conditional branching)
  ↓
  Check: instance.needs_expansion?
  ↓
  YES                                   NO
  ↓                                     ↓
  [Content Expansion Node]              [Use Brief Description]
  - LLM call with context:              - Copy brief_description
    * Base spec                         - Skip to next instance
    * Instance skeleton
    * Previous instances (for consistency)
    * Theme/category hints
  - Generate:
    * Detailed description
    * Abilities (NL)
    * Properties (stats)
    * Visual description
  - Deduplication check
  ↓
[Aggregation Node]
  - Collect expanded description
  - Update state with new instance
  - Check for conflicts/duplicates
  ↓
[Next Instance?]
  YES → Loop to [For Each Instance Node]
  NO  → Continue
  ↓
[Property Schema Inference]
  - Analyze all instances
  - Extract common properties
  - Generate schema
  ↓
[User Review Node] (Optional)
  - Present generated content
  - Flag potential duplicates
  - Allow modifications
  ↓
END
```

**State Structure**:
```typescript
interface ContentGeneratorState {
    base_spec: string;
    gamepiece_metadata: GamepieceMetadata[];
    current_type_index: number;
    current_instance_index: number;
    generated_descriptions: GamepieceDescription[];
    property_schemas: Map<string, PropertySchema[]>;
    conflicts: Conflict[];
}
```

**Content Expansion Node Logic**:
```typescript
async function expandInstanceContent(
    state: ContentGeneratorState,
    instance: InstanceSkeleton
): Promise<GamepieceDescription> {
    // Get context from previously generated instances
    const previousInstances = state.generated_descriptions
        .filter(d => d.gamepiece_type === instance.gamepiece_type);
    
    // Build prompt with full context
    const prompt = `
        Game Spec: ${state.base_spec}
        
        Gamepiece Type: ${instance.gamepiece_type}
        
        Generate detailed content for:
        Name: ${instance.name}
        Brief Description: ${instance.brief_description}
        Category: ${instance.category}
        Theme: ${instance.theme}
        
        Previously generated instances (DO NOT DUPLICATE):
        ${previousInstances.map(p => `- ${p.name}: ${p.abilities}`).join('\n')}
        
        Generate UNIQUE abilities that:
        1. Don't duplicate previous instances
        2. Fit the theme/category
        3. Are balanced and playable
        4. Match the game mechanics described in the spec
        
        Output format: {name, description, properties, abilities, visual_description}
    `;
    
    const result = await llmCall(prompt);
    
    // Deduplication check
    if (hasSimilarAbilities(result, previousInstances)) {
        // Retry with stronger uniqueness prompt
        result = await retryWithUniquenessConstraint(prompt, result);
    }
    
    return result;
}
```

**Deduplication Strategy**:
```typescript
function hasSimilarAbilities(
    newInstance: GamepieceDescription,
    existingInstances: GamepieceDescription[]
): boolean {
    // Check for semantic similarity in abilities
    for (const existing of existingInstances) {
        const similarity = calculateSemanticSimilarity(
            newInstance.abilities, 
            existing.abilities
        );
        if (similarity > 0.8) {  // Threshold for "too similar"
            return true;
        }
    }
    return false;
}
```

**Parallelization Option**:
For non-conflicting instances, can batch:
```typescript
// Group instances by theme/category
const batches = groupInstancesByTheme(instances);

// Process each batch sequentially, instances within batch in parallel
for (const batch of batches) {
    const results = await Promise.all(
        batch.map(instance => expandInstanceContent(state, instance))
    );
    // Check for intra-batch duplicates
    validateNoDuplicates(results);
    state.generated_descriptions.push(...results);
}
```

**Example Workflow**:
```
Metadata Extractor Output:
  - creature_card (100 instances with brief_description, needs_expansion: true)

User: Reviews instance list, modifies some brief descriptions

Content Generator Workflow:
  ↓
  Instance 1: fire_drake
    - Expand with LLM (no previous context)
    - Generate abilities
  ↓
  Instance 2: ice_wizard
    - Expand with LLM (context: fire_drake)
    - Ensure abilities differ from fire_drake
  ↓
  Instance 3: forest_guardian
    - Expand with LLM (context: fire_drake, ice_wizard)
    - Ensure unique abilities
  ↓
  ... continue for all 100 instances
  ↓
  Property Schema Inference:
    - All creatures have: attack, defense, mana_cost
  ↓
  Output: 100 gamepiece_descriptions (all unique)
```

### Phase 3: UX Discovery

**Input**: 
- Base Game Spec
- gamepiece_metadata (minimal or expanded)

**Process**:
1. **Extract gamepiece types** (MUST use metadata IDs/quantities)
2. **Identify inventories**:
   - Parse spec for: "hand", "deck", "pile", "board", "zone", etc.
   - Determine what each inventory accepts
   - Infer default visibility from context
   - Determine scope (game/player/team)
   - Identify capacity constraints
3. **Identify actions**:
   - Parse spec for player actions: "draw", "play", "discard", "move", etc.
   - Determine source/target inventories
   - Assign triggers (command patterns, click, drag)
4. **Generate layout hints** (optional)
5. **Validate** against gamepiece_metadata
6. Output UX DSL

**Validation Rules**:
```typescript
function validateUXDSL(uxdsl: UXManifest, metadata: GamepieceMetadata[]): void {
    // All gamepiece types must match metadata
    uxdsl.gamepieceTypes.forEach(gp => {
        const meta = metadata.find(m => m.id === gp.id);
        if (!meta) throw new Error(`Unknown gamepiece type: ${gp.id}`);
        if (meta.quantity !== gp.quantity) {
            throw new Error(`Quantity mismatch for ${gp.id}`);
        }
    });
    
    // All inventory accepts must reference valid gamepiece types
    uxdsl.inventories.forEach(inv => {
        inv.accepts.forEach(typeId => {
            if (!uxdsl.gamepieceTypes.find(gp => gp.id === typeId)) {
                throw new Error(`Inventory ${inv.id} accepts unknown type: ${typeId}`);
            }
        });
    });
    
    // All actions must reference valid inventories
    uxdsl.actions.forEach(action => {
        if (action.source && !uxdsl.inventories.find(i => i.id === action.source)) {
            throw new Error(`Action ${action.id} references unknown source: ${action.source}`);
        }
        if (action.target && !uxdsl.inventories.find(i => i.id === action.target)) {
            throw new Error(`Action ${action.id} references unknown target: ${action.target}`);
        }
    });
}
```

### Phase 4: Code Generation

**Input**:
- Base Game Spec (rules, mechanics, win conditions)
- gamepiece_metadata
- gamepiece_descriptions (if available)
- UX DSL

**SWE Agent Constraints**:
- **MUST** implement all inventories from UX DSL
- **MUST** implement all actions from UX DSL
- **MUST** create components for gamepiece properties (from descriptions or inferred)
- **SHOULD** implement visibility override system
- **SHOULD** provide runtime query API

**Generated Code Structure**:
```typescript
// Inventory type enum (from UX DSL)
enum InventoryType {
    DECK = 1,
    HAND = 2,
    PLAY_AREA = 3
}

// Gamepiece components (from descriptions or inferred)
registerCustomComponent(world, 'Rank', ['rank'], ['string']);
registerCustomComponent(world, 'Suit', ['suit'], ['string']);

// Inventory definitions (from UX DSL)
defineInventoryType(world, InventoryType.DECK, [cardGamepieceTypeId]);
defineInventoryType(world, InventoryType.HAND, [cardGamepieceTypeId]);

// Actions (from UX DSL + gamepiece_descriptions abilities)
createPlayerInputSystem(world, [
    {
        pattern: /^draw$/i,
        action: (world, playerId) => {
            addDrawCardAction(world, playerId);
        }
    }
]);

// Visibility override system
function getInventoryVisibility(inventoryId: number, requestingPlayerId: number) {
    // Check runtime game state for overrides
    if (getGameState(world) === GameState.REVEAL_PHASE) {
        return 'public';  // Override UX DSL default
    }
    
    // Fall back to UX DSL default (from uxdsl.inventories[].visibility)
    return getDefaultVisibility(inventoryId);
}
```

### Phase 5: Plugin Generation

**Input**:
- UX DSL
- Game Module (for runtime API)
- Content Manifests (for visual assets - optional)

**Process** (Platform-specific):

**Form Plugin**:
```typescript
// Generated form-based renderer
function renderGame(gameModule: IModule, currentPlayer: string) {
    const uxdsl = loadUXDSL();
    
    // Render inventories
    uxdsl.inventories.forEach(inv => {
        const visibility = gameModule.getInventoryVisibility(inv.id, currentPlayer);
        const contents = gameModule.getInventoryContents(currentPlayer, inv.id);
        
        if (visibility === 'hidden') {
            return;  // Don't render
        } else if (visibility === 'count_only') {
            renderLabel(`${inv.label}: ${contents.length} items`);
        } else if (visibility === 'owner') {
            renderCardList(inv.label, contents);
        } else {
            renderPublicCardList(inv.label, contents);
        }
    });
    
    // Render actions
    uxdsl.actions.forEach(action => {
        if (action.trigger === 'command') {
            renderTextInput(action.label, action.pattern);
        } else if (action.trigger === 'click') {
            renderButton(action.label, () => executeAction(action.id));
        }
    });
}
```

---

## Examples

### Example 1: Rock Paper Scissors (Simple - No Content Generator)

**Base Spec**:
```
Rock, Paper, Scissors
- 2 players
- Best of 3 rounds
- Players simultaneously choose rock, paper, or scissors
- Rock beats scissors, scissors beats paper, paper beats rock
```

**Metadata Extraction Output**:
```yaml
gamepiece_metadata:
  - id: rps_choice
    type: piece
    quantity: 3
    description: "Player choices: rock, paper, or scissors"
    instances:
      - id: rock
        name: "Rock"
        brief_description: "Rock crushes scissors"
        needs_expansion: false
      - id: paper
        name: "Paper"
        brief_description: "Paper covers rock"
        needs_expansion: false
      - id: scissors
        name: "Scissors"
        brief_description: "Scissors cuts paper"
        needs_expansion: false
```

**UX DSL**:
```yaml
game:
  name: "Rock, Paper, Scissors"
  maxPlayers: 2

gamepieceTypes:
  - id: rps_choice
    type: piece
    quantity: 3

inventories:
  - id: PLAYER_CHOICE
    label: "Your Choice"
    accepts: [rps_choice]
    visibility: owner
    scope: player
    capacity: { max: 1 }
    
  - id: REVEALED_CHOICES
    label: "Played Choices"
    accepts: [rps_choice]
    visibility: public
    scope: game
    capacity: { max: 2 }

actions:
  - id: choose_rock
    label: "Choose Rock"
    type: move
    source: PLAYER_CHOICE
    target: REVEALED_CHOICES
    trigger: command
    pattern: "r"
    
  - id: choose_paper
    label: "Choose Paper"
    type: move
    source: PLAYER_CHOICE
    target: REVEALED_CHOICES
    trigger: command
    pattern: "p"
    
  - id: choose_scissors
    label: "Choose Scissors"
    type: move
    source: PLAYER_CHOICE
    target: REVEALED_CHOICES
    trigger: command
    pattern: "s"
```

### Example 2: Poker (Moderate - Standard Template)

**Base Spec**:
```
Texas Hold'em Poker
- 2-8 players
- Standard 52-card deck
- Each player gets 2 hole cards (private)
- 5 community cards dealt in phases (flop, turn, river)
- Betting rounds between card reveals
- Best 5-card poker hand wins
```

**Metadata Extraction Output**:
```yaml
gamepiece_metadata:
  - id: playing_card
    type: card
    quantity: 52
    description: "Standard playing card deck"
    template: standard_52_deck  # Recognized pattern
    instances:
      # Template expands to standard 52 cards
      - id: ace_of_spades
        name: "Ace of Spades"
        brief_description: "Ace of Spades"
        needs_expansion: false
      - id: king_of_spades
        name: "King of Spades"
        brief_description: "King of Spades"
        needs_expansion: false
      # ... 50 more standard cards (auto-generated from template)
```

**UX DSL**:
```yaml
game:
  name: "Texas Hold'em Poker"
  maxPlayers: 8

gamepieceTypes:
  - id: playing_card
    type: card
    quantity: 52
    visual:
      backImage: "cards/back.svg"

inventories:
  - id: DECK
    label: "Deck"
    accepts: [playing_card]
    visibility: count_only
    scope: game
    
  - id: HOLE_CARDS
    label: "Hole Cards"
    accepts: [playing_card]
    visibility: owner
    scope: player
    capacity: { max: 2 }
    layoutHint: spread
    
  - id: COMMUNITY_CARDS
    label: "Community Cards"
    accepts: [playing_card]
    visibility: public
    scope: game
    capacity: { max: 5 }
    layoutHint: spread
    
  - id: MUCK
    label: "Discarded Cards"
    accepts: [playing_card]
    visibility: count_only
    scope: game

actions:
  - id: deal_hole_cards
    label: "Deal Hole Cards"
    type: move
    source: DECK
    target: HOLE_CARDS
    trigger: command
    pattern: "deal"
    
  - id: fold
    label: "Fold"
    type: move
    source: HOLE_CARDS
    target: MUCK
    trigger: command
    pattern: "fold"
```

### Example 3: Fantasy Card Game (Complex - Uses Content Generator)

**Base Spec**:
```
Fantasy Card Battle
- 2 players
- Each player has a deck of 60 cards (from a pool of 200 unique cards)
- Cards are creatures, spells, or enchantments
- Creatures have attack, defense, mana cost, and special abilities
- Players draw 7 cards, play creatures and spells, attack opponent
- Reduce opponent life to 0 to win
```

**Metadata Extraction Output** (with instance skeletons):
```yaml
gamepiece_metadata:
  - id: creature_card
    type: card
    quantity: 150
    description: "Unique creature cards with abilities"
    instances:
      - id: fire_drake
        name: "Fire Drake"
        brief_description: "A dragon that breathes fire"
        needs_expansion: true
        category: rare
        theme: fire
        role: attacker
      - id: ice_wizard
        name: "Ice Wizard"
        brief_description: "A wizard with ice magic"
        needs_expansion: true
        category: common
        theme: ice
        role: support
      # ... 148 more creature skeletons
    
  - id: spell_card
    type: card
    quantity: 40
    description: "Unique spell cards with effects"
    instances:
      - id: fireball
        name: "Fireball"
        brief_description: "Direct damage spell"
        needs_expansion: true
        theme: fire
      # ... 39 more spell skeletons
    
  - id: enchantment_card
    type: card
    quantity: 10
    description: "Unique enchantment cards with ongoing effects"
    instances:
      - id: burning_field
        name: "Burning Field"
        brief_description: "Ongoing fire damage to all creatures"
        needs_expansion: true
        theme: fire
      # ... 9 more enchantment skeletons
```

**Designer Reviews**:
```
Designer reviews instance skeletons:
  - "Fire Drake looks good"
  - Modifies "Ice Wizard" brief_description to "A master of frost magic"
  - Adds new instance: "Shadow Assassin"
  - Updates quantity to 151
```

**Content Expansion Workflow Runs**:
```
LangGraph processes each instance sequentially:
  
Instance 1: fire_drake (needs_expansion: true)
  → Content Expansion Node
  → Generate abilities (no previous context)
  → Output: abilities, properties, visual_description
  
Instance 2: ice_wizard (needs_expansion: true)
  → Content Expansion Node
  → Generate abilities (context: fire_drake already done)
  → Deduplication check: ensure different from fire_drake
  → Output: abilities, properties, visual_description
  
... continues for all 151 creatures, 40 spells, 10 enchantments
```

**Content Generator Output** (expanded descriptions):
```yaml
gamepiece_metadata:
  - id: creature_card
    type: card
    quantity: 150
    has_unique_abilities: true
    properties_schema:
      - { name: attack, type: number }
      - { name: defense, type: number }
      - { name: mana_cost, type: number }
      - { name: creature_type, type: string }

gamepiece_descriptions:
  - id: fire_drake
    gamepiece_type: creature_card
    name: "Fire Drake"
    description: "A fierce dragon breathing flames"
    properties:
      attack: 5
      defense: 4
      mana_cost: 6
      creature_type: dragon
    abilities: |
      When Fire Drake enters the battlefield, deal 2 damage to target creature.
      At the beginning of your turn, Fire Drake deals 1 damage to each opponent.
    usage: |
      Best played mid-game when you have enough mana. Use the enter-battlefield
      ability to remove a threat.
    visual_description: |
      A red dragon with glowing eyes and flames emanating from its mouth,
      perched on a rocky outcrop.
      
  # ... 149 more creature cards
  # ... 40 spell cards
  # ... 10 enchantment cards
```

**UX DSL** (uses metadata IDs/quantities):
```yaml
game:
  name: "Fantasy Card Battle"
  maxPlayers: 2

gamepieceTypes:
  - id: creature_card
    type: card
    quantity: 150
    visual:
      displayMode: detailed
      
  - id: spell_card
    type: card
    quantity: 40
    visual:
      displayMode: detailed
      
  - id: enchantment_card
    type: card
    quantity: 10
    visual:
      displayMode: detailed

inventories:
  - id: LIBRARY
    label: "Library"
    accepts: [creature_card, spell_card, enchantment_card]
    visibility: count_only
    scope: player
    
  - id: HAND
    label: "Hand"
    accepts: [creature_card, spell_card, enchantment_card]
    visibility: owner
    scope: player
    capacity: { max: 10 }
    layoutHint: fan
    
  - id: BATTLEFIELD
    label: "Battlefield"
    accepts: [creature_card, enchantment_card]
    visibility: public
    scope: player
    layoutHint: grid
    
  - id: GRAVEYARD
    label: "Graveyard"
    accepts: [creature_card, spell_card, enchantment_card]
    visibility: public
    scope: player

actions:
  - id: draw_card
    label: "Draw Card"
    type: move
    source: LIBRARY
    target: HAND
    trigger: command
    pattern: "draw"
    
  - id: play_creature
    label: "Play Creature"
    type: move
    source: HAND
    target: BATTLEFIELD
    trigger: click
    description: "Pay mana cost to summon creature"
    
  - id: cast_spell
    label: "Cast Spell"
    type: move
    source: HAND
    target: GRAVEYARD
    trigger: click
    description: "Pay mana cost to cast spell, then discards"
```

---

## Validation & Constraints

### Metadata Validation

```typescript
function validateGamepieceMetadata(metadata: GamepieceMetadata[]): void {
    metadata.forEach(gp => {
        // Required fields
        assert(gp.id, "Gamepiece must have ID");
        assert(gp.type, "Gamepiece must have type");
        assert(gp.quantity > 0, "Gamepiece must have positive quantity");
        assert(gp.description, "Gamepiece must have description");
        
        // ID format (lowercase, underscores)
        assert(/^[a-z][a-z0-9_]*$/.test(gp.id), 
            `Invalid gamepiece ID format: ${gp.id}`);
    });
}
```

### UX DSL Validation

```typescript
function validateUXDSL(uxdsl: UXManifest, metadata: GamepieceMetadata[]): void {
    // Gamepiece types must match metadata
    uxdsl.gamepieceTypes.forEach(gp => {
        const meta = metadata.find(m => m.id === gp.id);
        assert(meta, `Unknown gamepiece type: ${gp.id}`);
        
        if (meta.quantity && gp.quantity) {
            assert(meta.quantity === gp.quantity, 
                `Quantity mismatch for ${gp.id}: UX DSL says ${gp.quantity}, metadata says ${meta.quantity}`);
        }
    });
    
    // Inventories must reference valid gamepiece types
    uxdsl.inventories.forEach(inv => {
        assert(inv.id, "Inventory must have ID");
        assert(inv.accepts && inv.accepts.length > 0, 
            `Inventory ${inv.id} must accept at least one gamepiece type`);
        
        inv.accepts.forEach(typeId => {
            assert(uxdsl.gamepieceTypes.find(gp => gp.id === typeId),
                `Inventory ${inv.id} accepts unknown gamepiece type: ${typeId}`);
        });
    });
    
    // Actions must reference valid inventories (if specified)
    uxdsl.actions.forEach(action => {
        if (action.source) {
            assert(uxdsl.inventories.find(i => i.id === action.source),
                `Action ${action.id} references unknown source inventory: ${action.source}`);
        }
        if (action.target) {
            assert(uxdsl.inventories.find(i => i.id === action.target),
                `Action ${action.id} references unknown target inventory: ${action.target}`);
        }
    });
}
```

### Code Generation Validation

```typescript
function validateGeneratedCode(
    code: GameModule, 
    uxdsl: UXManifest
): void {
    // All UX DSL inventories must be implemented
    uxdsl.inventories.forEach(inv => {
        assert(code.hasInventoryType(inv.id),
            `Generated code missing inventory: ${inv.id}`);
    });
    
    // All UX DSL actions must be implemented
    uxdsl.actions.forEach(action => {
        assert(code.hasAction(action.id),
            `Generated code missing action: ${action.id}`);
    });
    
    // Game module must provide runtime API
    assert(typeof code.getInventoryVisibility === 'function',
        "Generated code must provide getInventoryVisibility API");
    assert(typeof code.getInventoryContents === 'function',
        "Generated code must provide getInventoryContents API");
}
```

---

## Future Considerations

### Nested Inventories

Support for gamepieces that can contain other gamepieces (e.g., tokens on cards):

```yaml
gamepieceTypes:
  - id: quest_card
    type: card
    canContain:  # Future extension
      - id: progress_token
        type: token
        capacity: { max: 5 }
```

### Conditional Visibility

Support for complex visibility rules:

```yaml
inventories:
  - id: HAND
    visibility:
      default: owner
      conditional:  # Future extension
        - if: "game.phase == 'reveal'"
          then: public
        - if: "gamepiece.revealed == true"
          then: public
```

### Multi-Step Actions

Support for actions requiring multiple steps or choices:

```yaml
actions:
  - id: trade_resources
    type: exchange  # Future extension
    steps:
      - { source: RESOURCES, count: 3, filter: "any" }
      - { target: VICTORY_POINTS, count: 1 }
```

### Dynamic Actions

Support for actions whose availability depends on game state:

```yaml
actions:
  - id: draw_card
    available_when: "game.phase == 'draw_phase' && player.hasDrawsRemaining"  # Future
```

### Layout Regions

More sophisticated layout hints for complex board games:

```yaml
layout:
  regions:
    - id: player_area
      type: composite  # Future extension
      children:
        - { id: hand, binding: "player.hand" }
        - { id: tableau, binding: "player.tableau" }
        - { id: resources, binding: "player.resources" }
```

---

## Summary

The UX DSL architecture provides a clean separation between:
- **Structure** (what exists) - UX DSL
- **State** (what's happening) - Game Module runtime
- **Presentation** (how it looks) - Plugins

By keeping the UX DSL focused on structure and defaults, we:
- Avoid duplicating game logic
- Enable runtime flexibility
- Support multiple rendering platforms
- Simplify agent coordination
- Maintain single sources of truth

The optional Content Generator tool allows the system to scale from simple games (RPS) to complex games (200+ unique cards) without forcing unnecessary work on designers.
