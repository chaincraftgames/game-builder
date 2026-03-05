/**
 * CT Arena — Spec Processing Integration Test Fixture
 *
 * Based on real production game (ID: c75be3b7-eca2-44aa-b7a0-d52db824f2bb)
 * that failed in the spec-processing pipeline with two validation errors:
 *   1. publicMessage used in transition preconditions but never initialized
 *   2. gameEnded used in transition preconditions but never initialized
 *
 * CT Arena is a 2-player simultaneous-action battle game where players
 * adopt crypto Twitter personas and compete in turn-based combat with
 * an AI announcer providing boxing-match-style commentary.
 *
 * Narratives: Only the keys matter for spec processing (content is never
 * read — only Object.keys(specNarratives) is checked for narrative marker
 * validation). Stub values are used here to keep the fixture compact.
 */

// ─── Game Specification ───

export const CT_ARENA_SPEC = `# CT Arena - Game Specification

## Game Overview

CT Arena is a 2-player simultaneous-action battle game where players adopt crypto Twitter personas and compete in a turn-based combat system, with an AI announcer providing boxing-match-style play-by-play commentary and satirical persona-specific tweets for each turn.

## Game Setup

### Player Count
- Exactly 2 players required

## Intro Phase

### Announcer Introduction & Persona Selection
- The announcer delivers a brief dramatic introduction (1-2 sentences maximum)
- The introduction must hype up CT Arena and the upcoming battle
- The introduction must lead directly into persona selection without pause

!___ NARRATIVE:ANNOUNCER_INTRO ___!

### Persona Selection with Integrated Descriptions
- Immediately after the brief introduction, both players are prompted to select their personas
- All 5 persona options are displayed simultaneously with their descriptions:
  - Bull (with brief fighting style description)
  - Bear (with brief fighting style description)
  - Maxi (with brief fighting style description)
  - Degen (with brief fighting style description)
  - Analyst (with brief fighting style description)
- Each persona description is 1 sentence maximum
- Descriptions are shown as part of the selection interface, not announced separately
- Players can see all options and descriptions at once to make informed choices
- Each player selects one persona from the 5 available options
- Selections are made simultaneously
- Selections remain hidden from both players until both have chosen
- Once selected, personas cannot be changed during the match

!___ NARRATIVE:PERSONA_DESCRIPTIONS ___!

### Persona Reveal
- Immediately after both players have made their selections, the announcer dramatically reveals both personas in quick succession
- The announcer must reveal Player 1's persona first, then immediately reveal Player 2's persona
- Each reveal must be dramatic and match boxing/wrestling commentary style
- The total reveal sequence must be brief (2-3 sentences total for both reveals)
- The reveal must transition directly into Turn 1 without additional narrative content

!___ NARRATIVE:PERSONA_REVEAL ___!

### Starting Conditions
- Each player begins with 30 HP
- HP is visible to both players at all times
- No other resources or stats are tracked
- Both players now know each other's selected persona
- Turn 1 begins immediately after persona reveal

## Turn Structure

Each turn consists of three sequential phases:

### 1. Action Phase

#### Move Display
- Before players make selections, the announcer displays the three available moves
- The announcer must present each move in boxing/wrestling commentary style:
  - **Shill**: Deals 8 base damage
  - **FUD**: Deals 12 base damage with 30% miss chance
  - **Ratio**: Deals 5 base damage, or 15 base damage if opponent selected Shill
- The announcer's move presentation must hype up each option as a viable strategy

!___ NARRATIVE:MOVE_PRESENTATION ___!

#### Move Selection
- After the move display, both players simultaneously select one move
- Players select without seeing their opponent's choice
- Selections are hidden until the Reveal Phase

### 2. Reveal Phase
- Both players' move selections are revealed simultaneously
- The announcer declares both moves in boxing/wrestling commentary style
- No damage is calculated or applied during this phase
- Moves become public knowledge
- The announcer's reveal must build tension before resolution

!___ NARRATIVE:MOVE_REVEAL ___!

### 3. Resolution Phase

The Resolution Phase proceeds in this exact order:

#### Step 1: Persona Tweet Generation
- Before damage is calculated, the game generates a persona-specific tweet from each player
- Each tweet must reflect the style and tone of that player's selected persona
- Each tweet must reference or relate to the move that player selected this turn
- Both tweets are displayed to both players
- Tweets are displayed in the order: Player 1's tweet, then Player 2's tweet

!___ NARRATIVE:PLAYER_TWEETS ___!

#### Step 2: Damage Calculation
- Damage is calculated using the damage calculation rules (detailed below)
- Calculation is performed but not yet announced

#### Step 3: Damage Announcement
- The announcer declares the damage dealt by each player in boxing/wrestling commentary style
- The announcer must state the numerical damage value for each player
- If a type matchup bonus triggered (+3 damage modifier), the announcer must declare the hit as "SUPER EFFECTIVE"
- "SUPER EFFECTIVE" declaration applies only when the attacker's persona type beats the defender's type (triggering the +3 bonus)
- Defensive type advantages (triggering -3 penalty) are NOT declared as "SUPER EFFECTIVE"
- If FUD missed (30% chance), the announcer must dramatically announce the miss
- The announcer's commentary must react appropriately to the damage amounts and effectiveness

!___ NARRATIVE:DAMAGE_ANNOUNCEMENT ___!

#### Step 4: HP Application
- Calculated damage is applied to player HP totals
- HP cannot go below 0
- Updated HP totals are visible to both players

#### Step 5: Turn End
- Turn ends after HP is applied
- If no win/loss/tie condition is met, the next turn begins

## Damage Calculation

Damage is calculated in the following order:

### Step 1: Base Damage Determination
- Shill: 8 damage
- FUD: 12 damage
- Ratio: 5 damage, OR 15 damage if opponent selected Shill

### Step 2: Type Matchup Modification
Type matchups follow this cycle:
- Bull beats Bear
- Bear beats Degen
- Degen beats Maxi
- Maxi beats Analyst
- Analyst beats Bull

**Modifier Application:**
- If attacker's persona type beats defender's type: Add +3 damage
- If defender's persona type beats attacker's type: Subtract -3 damage
- If neither beats the other (same type or no matchup): No modification
- Damage cannot be reduced below 0 by type modifiers

### Step 3: Miss Chance Resolution (FUD only)
- FUD has a 30% chance to miss after type modifiers are applied
- If FUD misses: 0 damage is dealt regardless of calculated damage
- Shill and Ratio never miss

### Step 4: Final Damage Value
- Final calculated damage is determined
- This value will be subtracted from the defender's HP during Resolution Phase Step 4

## Information Visibility

### Pre-Game Information
- Both players see the announcer's brief introduction
- Both players see all 5 available persona types with descriptions during selection
- Both players know each other's selected persona after the reveal
- Starting HP (30) is public knowledge

### During Turns
- Current HP totals are visible to both players at all times
- The announcer's move presentation is visible to both players
- Move selections are hidden during Action Phase
- Move selections become public during Reveal Phase
- Both players' persona tweets are visible to both players during Resolution Phase
- Damage calculations and announcements are public during Resolution Phase
- All announcer commentary is visible to both players

### Historical Information
- Players can see the results of all previous turns
- Previous move selections remain visible
- Previous damage dealt remains visible
- Previous persona tweets remain visible

## Win Conditions

### Loss Condition
- A player loses immediately when their HP reaches 0
- The losing player is eliminated from the match

### Win Condition
- A player wins immediately when their opponent's HP reaches 0
- The winning player is declared the match victor

### Tie Condition
- If both players reach exactly 0 HP on the same turn, the game ends in a tie
- Neither player wins or loses in a tie scenario

### Game End
- The game ends immediately when win, loss, or tie conditions are met
- No further turns are played after the game ends

## Post-Game Display

After the game ends (win, loss, or tie), the announcer delivers a battle recap:

!___ NARRATIVE:BATTLE_RECAP ___!

**Recap Requirements:**
- Delivered in boxing/wrestling announcer commentary style
- Exactly 2-3 sentences
- Summarizes the match outcome
- Mentions both players' personas
- Must declare the winner (or tie) clearly
- Maintains satirical crypto Twitter tone within announcer's voice
- Displayed once after win/loss/tie determination

## Game Constraints

### Timing
- Players must select personas during the Intro Phase
- Players must select moves during the Action Phase
- No time limit is specified for selections
- Game proceeds to next phase only after both players have selected

### Fairness
- Both players have access to identical move options each turn
- Type matchup advantages are symmetrical and deterministic
- FUD's miss chance is the only random element in damage calculation
- Random elements (miss chance, narrative generation) use fair probability distribution
- Both players receive identical information from the announcer at all times

### Turn Progression
- Intro Phase must complete before Turn 1 begins
- Turns continue sequentially until a win/loss/tie condition is met
- There is no maximum turn limit
- Players cannot skip turns or pass

### Announcer Consistency
- The announcer's voice and tone must remain consistent throughout the entire match
- Boxing/wrestling commentary style must be maintained in all announcer dialogue
- The announcer must acknowledge game state changes (damage, HP, effectiveness) appropriately
`;

// ─── Narrative Stubs (only keys matter for spec processing) ───

export const CT_ARENA_NARRATIVES: Record<string, string> = {
  PERSONA_TWEETS: '(stub)',
  CELEBRITY_REACTIONS: '(stub)',
  BATTLE_RECAP: '(stub)',
  ANNOUNCER_INTRO: '(stub)',
  PERSONA_DESCRIPTIONS: '(stub)',
  PERSONA_REVEAL: '(stub)',
  MOVE_PRESENTATION: '(stub)',
  MOVE_REVEAL: '(stub)',
  PLAYER_TWEETS: '(stub)',
  DAMAGE_ANNOUNCEMENT: '(stub)',
};

// ─── Production Validation Errors (for reference) ───

export const CT_ARENA_PRODUCTION_ERRORS = [
  "Field `game.publicMessage` is used in transition preconditions but is never initialized by the init transition",
  "Field `game.gameEnded` is used in transition preconditions but is never initialized by the init transition",
];
