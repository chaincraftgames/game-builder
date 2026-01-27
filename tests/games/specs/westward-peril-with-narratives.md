# Westward Peril: Game Specification (Skeleton)

## Game Overview

Westward Peril is a single-player narrative adventure game where you journey westward across dangerous frontier territories. Your goal is to survive 5 critical encounters by making wise choices, avoiding deadly outcomes, and ultimately reaching the western coast alive.

**Core Objective**: Successfully navigate all 5 turns of your westward journey by choosing non-deadly options at each critical juncture. Reach the west coast to achieve victory. One wrong choice means death and immediate game over.

**Narrative Generation**: Each playthrough generates a unique story driven by your character's random motivation for traveling west. Every scenario, choice description, and outcome is created fresh by AI each playthrough.

## Tone & Narrative Style

<!-- NARRATIVE:TONE_STYLE -->

## Game Setup

### Starting a New Game

1. **Generate Random Motivation**: At the start of each new game, the system randomly selects one motivation from the following list:
   - Fleeing the law after a crime
   - Seeking fortune in gold or opportunity
   - Escaping a supernatural curse or haunting
   - Rescuing a captured loved one
   - Running from debt collectors or criminals
   - Chasing a person who wronged you
   - Seeking religious sanctuary or freedom
   - Starting over after personal tragedy
   - Following a treasure map or legend
   - Fulfilling a dying person's final wish

2. **Reveal Motivation to Player**: The chosen motivation is displayed to the player immediately at game start, before Turn 1 begins. This motivation remains visible throughout gameplay.

3. **Initialize Journey Progress**: Journey begins at Turn 1 of 5. Current turn number is always visible.

4. **Generate First Encounter**: AI procedurally generates the first narrative scenario based on the player's specific motivation and westward journey themes.

## Gameplay Structure

### Turn Sequence

The game consists of exactly **5 turns**. Each turn follows this sequence:

1. **Situation Description**: AI generates unique narrative scenario describing current circumstances, location, and immediate challenge.

2. **Choice Presentation**: AI generates exactly **4 distinct choices**, each as **a single sentence**:
   - 1 deadly choice (leads to death if selected)
   - 3 safe choices (allow continuation)
   - 1 motivation-aligned choice (always among the 3 safe choices)

3. **Choice Selection**: Player selects one of four choices without indicators, warnings, or hints.

4. **Outcome Resolution**: AI generates narrative consequence:
   - **Safe Choice**: 1-2 sentences describing successful navigation and continuation
   - **Deadly Choice**: Full paragraph (3-4 sentences minimum) explaining causal chain from choice to death, resulting in immediate game over

5. **Turn Advancement**: If player survived, game increments to next turn and AI generates new scenario.

### Turn Progression Details

- Turns advance sequentially (1 → 2 → 3 → 4 → 5)
- No skipping or returning to previous turns
- Each turn in different location, progressively further west
- Geographic progression: eastern settlements → prairies → mountains → deserts → western territories → coast
- Later turns may reference earlier choices for narrative coherence

## Choice System

### Choice Structure

Each turn presents exactly 4 choices with these properties:

**Deadly Choice (1 per turn)**:
- Exactly 1 choice per turn is deadly
- Position randomized each turn (no learnable pattern)
- Not marked or indicated during presentation
- Appears narratively plausible and reasonable
- Represents action leading to fatal consequences through clear causal chain

**Safe Choices (3 per turn)**:
- Remaining 3 choices allow continuation
- May have varying narrative consequences but none result in death
- May involve hardship but player survives to next turn

**Motivation-Aligned Choice (1 per turn)**:
- Exactly 1 choice per turn aligns with revealed motivation
- Directly serves, relates to, or advances character's reason for going west
- Always one of the 3 safe choices (never the deadly choice)
- Not explicitly marked but recognizable through narrative context

### Choice Design Principles

**Procedural Generation via AI**:
<!-- NARRATIVE:PROCEDURAL_GENERATION -->

**Choice Formatting**:
- Each choice written as single sentence describing action
- Choices are clear, direct, and action-oriented
- Choices distinct from one another in description and implied consequence

**Narrative Quality**:
<!-- NARRATIVE:CHOICE_QUALITY -->

**Fair Challenge**:
- All 4 choices appear plausible, reasonable, worth considering
- Deadly choice not obviously suicidal, nonsensical, or illogical
- Players succeed through consideration, narrative intuition, and luck

**Motivation Integration**:
- AI considers specific motivation when generating scenario and choices
- Motivation-aligned choice must authentically connect to character's goal
- Not every scenario must center on motivation, but it remains background element

## Failure System

### Game Over Conditions

The game ends immediately in failure when:
- Player selects the deadly choice during any turn (1-5)
- This is the **only** way to lose the game
- No other failure conditions exist

### Death & Deadly Choice Resolution

When player selects deadly choice:

1. **Causal Death Narrative**: AI generates full paragraph (3-4 sentences minimum) describing:
   - How chosen action led to death (specific causal chain)
   - Why this particular choice was fatal vs alternatives
   - Logical connection between action and lethal consequence

2. **Game Over Display**: Game clearly indicates death, journey ended, game over

3. **Progress Loss**: Current game progress completely lost

4. **Final Statistics**: Game displays:
   - Turn of Death (Turn 1-5)
   - Character Motivation
   - Brief Epitaph

### Restart Options

After failure, player may restart by:
- **Manually Exiting and Relaunching**: Must completely exit game and launch again. No "New Game" button exists within game interface.

**New Game Properties**:
- Each relaunched game begins with completely fresh, newly generated random motivation
- All scenarios, choices, and outcomes procedurally generated anew
- No content, knowledge, or progress from previous games carries over

## Victory Condition

### Winning the Game

Player achieves victory by:
- Successfully making non-deadly choices on all 5 turns
- Completing Turn 5 without selecting deadly choice
- Reaching western coast alive

### Victory Requirements

**Mandatory**:
- Survive all 5 turns by avoiding deadly choice each turn
- Make final choice on Turn 5 successfully

**Not Required for Victory**:
- Does NOT need to select motivation-aligned choice every turn
- Does NOT need to optimize narrative outcomes
- Does NOT need to fulfill character's motivation
- Simply surviving and reaching coast is sufficient

### Victory Resolution

When player successfully completes Turn 5 without dying:

1. **Final Arrival Narrative**: AI generates paragraph-length narrative describing arrival at western coast and conclusion of journey

2. **Motivation Resolution**: Narrative addresses whether player achieved original motivation or is positioned to pursue it

3. **Victory Display**: Game clearly indicates win and journey complete

4. **Concluding Statement**: AI generates paragraph-length final statement about character's fate or future at western coast

### Victory as Binary Outcome

Victory is **binary** - reach west coast alive (win) or die during journey (lose). There are no:
- Graduated success levels or partial victories
- Quality ratings or performance scores
- Metrics tracking choice quality or optimal paths

**Narrative Quality Variations**: While victory is binary, narrative content and quality varies based on specific safe choices made and whether motivation-aligned choices were selected. These variations affect only narrative content, not mechanical victory.

### Post-Victory Restart

After victory, player may start new game by:
- **Manually Exiting and Relaunching**: Same as failure restart mechanism

## Procedural Narrative System

### AI-Generated Content

Game uses AI to generate all narrative content fresh for each playthrough. **No content is pre-written, templated, or selected from fixed pool.**

**What AI Generates Each Turn**:

1. **Scenario Description**: Unique narrative describing current situation, location, challenge, and context

2. **Four Choice Descriptions**: Four distinct single-sentence descriptions of different actions

3. **Outcome Narrative**: After choice selection:
   - **Safe Choices**: 1-2 sentences explaining immediate consequences
   - **Deadly Choices**: Full paragraph (3-4 sentences minimum) explaining causal chain to death
   - **Victory**: Paragraph-length narratives for arrival and conclusion

**AI Generation Parameters**:

<!-- NARRATIVE:AI_GENERATION_PARAMETERS -->

### Replayability

Each new game provides completely unique content:
- Different random motivation (1 of 10 selected randomly)
- Fresh procedural scenarios (all 5 scenarios AI-generated anew)
- Unique choice descriptions (all 20 choices freshly written)
- Randomized deadly choices (position and nature change each playthrough)
- Varied narrative paths based on decisions
- No repeated content from previous playthroughs

## Turn Details & Gameplay Flow

### Turn 1: The Journey Begins

**Context**: Player just begun westward journey, in eastern territories or recently departed civilization.

**Required Elements**:
- Setting: Towns, settlements, outposts, departure points, early trails
- 4 choices (1 deadly, 3 safe, 1 motivation-aligned among safe)
- Deadly choice leads to death + game over
- Safe choice leads to Turn 2

**Narrative Guidance**:
<!-- NARRATIVE:TURN_1_GUIDE -->

### Turn 2: The Open Frontier

**Context**: Entered open frontier - prairies, grasslands, early wilderness. Civilization behind, committed to journey.

**Required Elements**:
- Setting: Prairies, grasslands, plains, river crossings, sparse settlements
- 4 choices with same deadly/safe structure

**Narrative Guidance**:
<!-- NARRATIVE:TURN_2_GUIDE -->

### Turn 3: Major Obstacles

**Context**: Significant geographic or situational challenges - mountains, rivers, dangerous territories. Journey becomes most difficult.

**Required Elements**:
- Setting: Mountains, deep wilderness, major rivers, canyons, hostile territories
- 4 choices with same deadly/safe structure

**Narrative Guidance**:
<!-- NARRATIVE:TURN_3_GUIDE -->

### Turn 4: The Lawless West

**Context**: Deep in western territories where rules barely apply. Close to goal but maximum danger.

**Required Elements**:
- Setting: Deserts, lawless territories, outlaw havens, extreme western wilderness
- 4 choices with same deadly/safe structure

**Narrative Guidance**:
<!-- NARRATIVE:TURN_4_GUIDE -->

### Turn 5: Journey's End

**Context**: Western coast within reach. Last major obstacle before goal. Victory or death determined by this choice.

**Required Elements**:
- Setting: Western territories, coast approach, final frontier, Pacific territories
- 4 choices with same deadly/safe structure
- Survive this choice = reach coast and win
- Choose wrongly = entire journey ends in death

**Narrative Guidance**:
<!-- NARRATIVE:TURN_5_GUIDE -->

## Constraints & Special Rules

### Mandatory Game Elements

**Fixed Turn Count**:
- Game is always exactly 5 turns
- No scenarios can extend or shorten journey length
- Turn count does not vary between playthroughs

**Fixed Choice Count**:
- Every turn presents exactly 4 choices
- No scenarios offer more or fewer options
- Choice count never changes

**One Deadly Choice Per Turn**:
- Each turn has exactly 1 deadly choice and exactly 3 safe choices
- This ratio is fixed and never changes

**Single Life System**:
- Player has exactly 1 life per playthrough
- No respawns, continues, extra lives, or second chances
- Death is permanent and ends game immediately

### Gameplay Constraints

**No Take-Backs**:
- Once choice selected, cannot be undone, reversed, or changed
- Outcome immediately revealed and permanently locked in

**No Save/Load System**:
- Game does not save progress mid-game
- No checkpoints, save points, or progress markers
- Each playthrough completed in one continuous session
- Closing/quitting game ends current attempt permanently

**No Hints, Warnings, or Indicators**:
- Game does not mark, flag, or indicate which choice is deadly
- No warnings, alerts, or hints before selecting any choice
- No visual cues or meta-information distinguish deadly from safe choices
- No indication which choice aligns with motivation

**Linear Progression**:
- Cannot skip turns or jump ahead
- Cannot return to or replay previous turns
- Journey only moves forward (Turn 1 → 2 → 3 → 4 → 5)
- No branching paths affecting turn order or count

**No Player History or Statistics**:
- Game does not track or display outcomes from previous playthroughs
- No history, statistics, records, or archives
- Each new game has no reference to previous attempts

**Manual Restart Mechanism**:
- After game ends (death or victory), no "New Game" button in game interface
- Must completely exit game instance and launch again to start new game

### Narrative Constraints

**Motivation Consistency**:
- Character's motivation never changes during playthrough
- All scenarios must respect established motivation
- Motivation-aligned choice must be thematically authentic
- Motivation remains consistent from start to end

**Western Frontier Theme**:
- All content fits historical/mythological American western frontier (roughly 1840s-1880s)
- Technology and culture match period (no anachronisms)
- Supernatural elements allowed only when tied to specific motivations involving them
- Supernatural content maintains frontier folklore tone, not fantasy/horror

**Death Plausibility**:
- Deadly choices must result in narratively justified deaths
- Deaths feel like reasonable, logical consequences of chosen action
- Causal link between choice and death must be explainable in full paragraph
- No arbitrary, illogical, or nonsensical deaths

**AI Content Quality**:
- Generated scenarios specific, detailed, unique (not generic or vague)
- Choice descriptions distinct single sentences describing clear actions
- Outcomes logically follow from choices made
- Narrative prose maintains consistent tone and quality
- Safe outcomes: 1-2 sentences; deadly outcomes: full paragraphs (3-4+ sentences)
- Victory narratives: paragraph-length for both arrival and conclusion

## Edge Cases & Clarifications

<!-- NARRATIVE:EDGE_CASES -->

## Summary of Win/Loss Conditions

### You Win When:
- Successfully complete all 5 turns without dying
- Make final choice on Turn 5 and it is not the deadly choice
- Reach western coast alive

### You Lose When:
- Select deadly choice on any turn (1-5)
- Character dies from selecting deadly choice
- Journey ends prematurely before Turn 5 completion

### Victory is Determined By:
- **Survival only** - reaching coast alive
- **NOT** by narrative quality, optimal choices, selecting motivation-aligned choices, achieving personal goal, or performance metrics

### No Other Outcomes:
- No draws, stalemates, ties, partial victories, or alternative endings
- Game complete when either victory or failure conditions met

## Implementation Guidance

### State Management for Deadly Options

**CRITICAL**: Game must store which choice index is deadly for each turn in game state to enable deterministic precondition checking.

**Required State Field**:
- Game state MUST include: `game.deadlyChoiceIndexPerTurn: number[]` (5 elements, one per turn)
- Array MUST be initialized during game setup with 5 randomly selected indices (0-3)
- Each turn's deadly choice index determined once and stored, not recalculated

**Initialization**:
- During game initialization, generate 5 random numbers (each 0-3) representing deadly choice for turns 1-5
- Store in deadly choice array: `[deadlyTurn1, deadlyTurn2, deadlyTurn3, deadlyTurn4, deadlyTurn5]`
- Example: `[2, 1, 3, 0, 2]` means turn 1's deadly choice is index 2, turn 2's is index 1, etc.

**Precondition Usage**:
- Transitions checking if choice was deadly MUST use `lookup` operation to access array
- Example: `{"lookup": [{"var": "game.deadlyChoiceIndexPerTurn"}, {"-": [{"var": "game.currentTurn"}, 1]}]}`
- Retrieves deadly choice index for current turn (using turn-1 for 0-based array indexing)
- Compare player's selected choice index against retrieved deadly index

**Why This Is Required**:
- Preconditions must be deterministic (cannot rely on AI generation or randomness at transition time)
- Storing deadly indices once allows transitions to check "was this choice deadly?" using pure logic
- The `lookup` operation enables dynamic array access using current turn number as index
