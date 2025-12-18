# Tag Mechanism for Agent Signaling

## Overview

The conversational agent uses **XML-style tags** (similar to the original `game-design-prompts.ts`) to signal routing decisions to the workflow. This approach is clearer and more reliable than trying to extract structured output from LLMs.

## Why Tags Instead of Structured Output?

Following the pattern from `game-design-prompts.ts`:

```typescript
// Original approach (game-design-prompts.ts)
export const gameDesignSpecificationRequestTag = "<game_specification_requested>";

// New approach (same pattern)
export const SPEC_UPDATE_TAG = "<spec_update_needed>";
export const METADATA_UPDATE_TAG = "<metadata_update_needed>";
```

**Benefits:**
1. **Simple to parse** - Just check if tag is present in response
2. **LLM-friendly** - Models understand tags well from training data
3. **Proven pattern** - Already working in existing codebase
4. **No schema drift** - Tags either exist or don't, no ambiguity
5. **Easy to debug** - Can see tags in raw LLM output

## Available Tags

### 1. `<game_title>...</game_title>`
**Purpose**: Specify the game title  
**Required**: Yes, always included  
**User-facing**: No (extracted and stored separately)

**Example:**
```
<game_title>Elemental Showdown</game_title>
```

### 2. `<spec_update_needed>`
**Purpose**: Signal that the specification agent should generate/update the spec  
**Required**: Only when spec updates are needed  
**User-facing**: No (internal routing signal)

**When to include:**
- User defines game rules, mechanics, or gameplay
- User describes states, phases, or turn structure
- User explains win conditions, scoring, or end game
- User requests spec generation

### 3. `<metadata_update_needed>`
**Purpose**: Signal that the metadata agent should extract gamepiece metadata  
**Required**: Only when metadata extraction is needed  
**User-facing**: No (internal routing signal)

**When to include:**
- User describes physical game components
- User specifies card decks, dice, boards, tokens
- User defines inventories or collections

## Example Responses

### No Updates Needed
```
Great! Rock-paper-scissors is a classic. Let me help you design it. 
A few questions:

1. Is this for 2 players, or do you want to support more?
2. Do you want best-of-X rounds, or single rounds?
3. Should we track win/loss history?

<game_title>Rock Paper Scissors</game_title>
```

### Spec Update Only
```
Perfect! I'll update the game specification with:
- 2 player requirement
- Best of 3 rounds format
- Win/loss history tracking

This gives us a nice competitive structure. Should we add any 
special rules, like sudden death if players tie after 3 rounds?

<game_title>Rock Paper Scissors Showdown</game_title>
<spec_update_needed>
```

### Metadata Update Only
```
Love it! Custom game pieces make it unique. I'll capture the 
metadata for those three hand signs. Let me confirm the matchups:
- Volcano beats dragon? (like rock beats scissors)
- Dragon beats wizard? (like scissors beats paper)
- Wizard beats volcano? (like paper beats rock)

Is that correct?

<game_title>Elemental Showdown</game_title>
<metadata_update_needed>
```

### Both Updates
```
Excellent twist! That adds a strategic layer since players need 
to manage their limited signs across the rounds. I'll update both 
the specification with this rule and the metadata to reflect that 
each player has exactly one of each sign available.

This means the best-of-3 becomes even more interesting - you use 
all your signs exactly once. Should we add a fourth sign to give 
players an extra choice, or keep it tight at three?

<game_title>Elemental Showdown</game_title>
<spec_update_needed>
<metadata_update_needed>
```

## Implementation

### Parsing Tags

```typescript
import { SPEC_UPDATE_TAG, METADATA_UPDATE_TAG, GAME_TITLE_TAG } from "./prompts.js";

// Extract game title
function extractGameTitle(response: string): string | undefined {
  const match = response.match(/<game_title>(.*?)<\/game_title>/s);
  return match ? match[1].trim() : undefined;
}

// Check if update tags are present
function hasTag(response: string, tag: string): boolean {
  return response.includes(tag);
}

// Usage
const gameTitle = extractGameTitle(responseText);
const specUpdateNeeded = hasTag(responseText, SPEC_UPDATE_TAG);
const metadataUpdateNeeded = hasTag(responseText, METADATA_UPDATE_TAG);
```

### Stripping Internal Tags

Tags should be removed before showing the response to users:

```typescript
function stripInternalTags(response: string): string {
  return response
    .replace(/<game_title>.*?<\/game_title>/gs, '')
    .replace(/<spec_update_needed>/g, '')
    .replace(/<metadata_update_needed>/g, '')
    .trim();
}

// User sees clean response
const userMessage = stripInternalTags(responseText);
```

## Prompt Instructions

The system prompt tells the agent how to use tags:

```
## RESPONSE REQUIREMENTS

1. **Always include a game title** in your response using the format:
   <game_title>Your Game Title Here</game_title>

2. **Signal when other agents need to work** using special tags:
   - Include <spec_update_needed> in your response if the specification 
     needs to be updated or generated
   - Include <metadata_update_needed> in your response if gamepiece 
     metadata needs to be extracted
   - You can include BOTH tags if both updates are needed
   - Do NOT mention these tags to the user - they are internal signals
```

## Few-Shot Examples

Examples demonstrate the tag usage:

```typescript
export const FEW_SHOT_EXAMPLES = [
  {
    user: "Let's do 2 players, best of 3",
    assistant: "Perfect! I'll update the spec...\n\n<game_title>RPS</game_title>\n<spec_update_needed>",
    flags: { spec_update_needed: true, metadata_update_needed: false }
  }
];
```

The `formatFewShotExamples()` function includes tag information in the formatted output:

```
**Example 2**: Game rules and structure defined - triggers spec update

User: "Let's do 2 players, best of 3, with history tracking"
Assistant: "Perfect! I'll update the game specification with:..."
Tags to include: <spec_update_needed>
```

## Comparison with Original Pattern

### Original (`game-design-prompts.ts`)
```typescript
export const gameDesignSpecificationRequestTag = "<game_specification_requested>";

// In prompt:
"Include <game_specification_requested> in your response to indicate 
that the full game design specification is being requested"
```

### New (conversational agent)
```typescript
export const SPEC_UPDATE_TAG = "<spec_update_needed>";
export const METADATA_UPDATE_TAG = "<metadata_update_needed>";

// In prompt:
"Include <spec_update_needed> in your response if the specification 
needs to be updated or generated"
```

**Same pattern, extended for multi-agent workflow.**

## Benefits for Users

Users never see the tags - they just have natural conversations:

**User:** "I want rock-paper-scissors with 2 players"  
**Agent:** "Perfect! I'll update the specification..."  
*(Behind the scenes: `<spec_update_needed>` routes to spec agent)*

**User:** "Use volcano, dragon, wizard instead"  
**Agent:** "Love it! I'll capture those gamepieces..."  
*(Behind the scenes: `<metadata_update_needed>` routes to metadata agent)*

Clean separation of concerns with simple, reliable routing.
