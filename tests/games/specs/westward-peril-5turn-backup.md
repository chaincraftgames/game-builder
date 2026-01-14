# Westward Peril: Game Specification

## Game Overview

Westward Peril is a single-player narrative adventure game where you journey westward across dangerous frontier territories. Your goal is to survive 5 critical encounters by making wise choices, avoiding deadly outcomes, and ultimately reaching the western coast alive.

Each playthrough generates a unique story driven by your character's random motivation for traveling west, which is revealed at the very start of the game. Every scenario, choice description, and outcome is created fresh by AI each playthrough, ensuring no two games are identical. Your success depends on careful judgment, narrative intuition, and some measure of luck.

**Core Objective**: Successfully navigate all 5 turns of your westward journey by choosing non-deadly options at each critical juncture. Reach the west coast to achieve victory. One wrong choice means death and immediate game over.

## Tone & Narrative Style

Westward Peril balances dramatic peril with the dark humor and grim fatalism characteristic of frontier survival stories. The game presents genuinely dangerous situations where death is always a possibility, but maintains narrative engagement rather than descending into pure melodrama or comedy.

**Narrative Approach**:
- Outcomes should feel consequential and dangerous
- Death is treated seriously as a permanent failure state
- The frontier setting allows for harsh realities and moral ambiguity
- Gallows humor and ironic twists are appropriate when they serve the story
- Survival carries weight - success feels earned, not guaranteed
- The tone respects both the danger of the journey and the determination of those who attempted it

The game acknowledges that westward pioneers faced genuine mortal threats (disease, violence, exposure, starvation) while recognizing the sometimes absurd or ironic nature of frontier survival stories. Death may be sudden or darkly ironic, but never arbitrary or played purely for laughs.

## Game Setup

### Starting a New Game

1. **Generate Random Motivation**: At the start of each new game, the system randomly selects one motivation from the following list that defines why your character is traveling west:
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

2. **Reveal Motivation to Player**: The chosen motivation is displayed to you **immediately at game start, before Turn 1 begins and before any scenario is presented**. This motivation is shown prominently and clearly, providing context for your journey before you face any decisions. Your motivation remains visible or easily referenced during gameplay so you can make informed decisions about which choices might align with your character's goals throughout all 5 turns.

3. **Initialize Journey Progress**: Your journey begins at Turn 1 of 5. You start somewhere in the eastern territories with the west coast as your distant destination. The current turn number is always visible to you.

4. **Generate First Encounter**: After your motivation is revealed, the game's AI procedurally generates the first narrative scenario based on your specific motivation and general westward journey themes. This scenario description is created fresh and on-the-spot - it is not selected from a pre-written template or pool of scenarios.

## Gameplay Structure

### Turn Sequence

The game consists of exactly **5 turns**, each representing a major encounter or decision point during your westward journey. Each turn follows this sequence:

1. **Situation Description**: The AI generates and presents a unique narrative scenario describing your current circumstances, location, and immediate challenge. This description is created fresh for this specific playthrough, incorporating elements tied to your particular motivation when thematically appropriate. The scenario feels like a natural progression of your westward journey and reflects your current geographic position.

2. **Choice Presentation**: The AI generates exactly **4 distinct choices** representing different approaches to the situation. Each choice is presented as **a single sentence** describing what action your character will take. The four choices include:
   - 1 deadly choice (leads to death if selected)
   - 3 safe choices (allow continuation of the journey)
   - 1 motivation-aligned choice (always among the 3 safe choices)

3. **Choice Selection**: You select one of the four choices. You make this selection without any indicators, warnings, or hints about which choice is deadly or which aligns with your motivation. You must rely on narrative context, your judgment, and consideration of your character's motivation.

4. **Outcome Resolution**: The AI generates a narrative consequence for your specific choice:
   - **Safe Choice Selected**: The AI generates **1-2 sentences** describing how you successfully navigate the situation and continue your journey. This brief narrative is unique to the choice you made and explains the immediate and relevant consequences. The outcome may be better or worse in narrative quality, but you survive. The turn ends and you proceed to the next turn.
   - **Deadly Choice Selected**: The AI generates **a full paragraph (3-4 sentences minimum)** explaining how and why your specific choice led to death or catastrophic failure. This detailed narrative creates a clear causal chain between the action you chose and the fatal outcome - it is not an arbitrary death. The explanation makes narrative sense within the context of the scenario and your choice, fully describing the sequence of events that led to your demise. The game ends immediately in defeat.

5. **Turn Advancement**: If you survived by selecting a safe choice, the game increments to the next turn (Turn 2, 3, 4, or 5) and the AI generates a completely new procedural scenario for that turn.

### Turn Progression Details

- Turns always advance sequentially (1 → 2 → 3 → 4 → 5)
- There are no ways to skip turns or return to previous turns
- Each turn takes place in a different location, progressively further west
- The geographic progression typically follows a pattern like: eastern settlements → prairies/grasslands → mountains/difficult terrain → deserts/hostile territories → western territories → coast approach
- Later turn scenarios may reference outcomes or choices from earlier turns to maintain narrative coherence

## Choice System

### Choice Structure

Each turn presents exactly 4 choices generated by AI for that specific scenario. These choices have the following properties:

**Deadly Choice (1 per turn)**:
- Exactly **1 choice** per turn is the deadly option
- Selecting the deadly choice immediately ends the game in failure
- The deadly choice is **randomized** each turn - its position among the 4 choices has no learnable pattern
- The deadly choice is not marked, flagged, or indicated in any way during choice presentation
- Deadly choices appear narratively plausible and reasonable - they are not obviously suicidal or illogical
- The deadly choice represents an action that leads to fatal consequences through a clear causal chain (explained in the death narrative)
- Examples of deadly outcomes include: ambush by bandits, fatal environmental hazard, betrayal, disease, fatal accident, lethal confrontation, exposure, drowning, falling, murder, execution, fatal wildlife attack

**Safe Choices (3 per turn)**:
- The remaining **3 choices** are safe and allow you to continue the journey
- Safe choices advance the narrative without ending the game
- Safe choices may have varying narrative consequences (some lead to better situations than others) but none result in death or game over
- Safe choices may involve hardship, injury, loss of resources, or difficult circumstances - but you survive to the next turn
- A safe choice does not mean an optimal choice, only a survivable one

**Motivation-Aligned Choice (1 per turn)**:
- Exactly **1 choice** per turn thematically aligns with your revealed motivation
- This choice represents an action that directly serves, relates to, or advances your character's reason for going west
- The motivation-aligned choice is **always** one of the 3 safe choices (it is never the deadly choice)
- Selecting the motivation-aligned choice provides narrative satisfaction and demonstrates progress toward your underlying goal
- The motivation-aligned choice is not explicitly marked or labeled, but should be recognizable through narrative context and consideration of your character's motivation
- The AI ensures this choice authentically connects to your specific motivation

### Choice Design Principles

**Procedural Generation via AI**: 
- All scenario descriptions and choice texts are generated fresh by AI each playthrough
- No scenarios, choices, or outcomes are pre-written, templated, or selected from a fixed pool
- The AI creates unique narrative content on-the-spot for each turn based on:
  - Your specific random motivation
  - Your current turn number (1-5)
  - The geographic progression of your journey
  - Previous choices and outcomes from earlier turns (for narrative coherence)
  - Western frontier themes and setting
- No two playthroughs present identical situations, even with the same motivation
- Generation maintains narrative coherence within each playthrough

**Choice Formatting**:
- Each choice is written as **a single sentence** describing the action your character will take
- Choices are clear, direct, and action-oriented
- Single-sentence format forces clarity and makes decision-making faster
- Choices should be distinct from one another in both description and implied consequence

**Narrative Quality**:
- Choices should feel distinct from one another in both action and outcome
- Each choice represents a meaningfully different approach or strategy
- Descriptions should be specific to the current situation (not generic or vague)
- Outcomes logically follow from the choice made - consequences feel earned

**Fair Challenge**:
- All 4 choices must appear plausible, reasonable, and worth considering
- The deadly choice should not be obviously suicidal, nonsensical, or illogical
- The deadly choice represents a genuine strategic option that happens to lead to death
- Players succeed through careful consideration, narrative intuition, and luck
- No meta-gaming knowledge from previous games provides guaranteed safety
- The AI does not create deliberately unfair or arbitrary deadly choices

**Motivation Integration**:
- The AI considers your specific motivation when generating both the scenario and the choices
- At least one choice (the motivation-aligned choice) directly relates to your reason for going west
- Other choices may indirectly reference or acknowledge your motivation
- Not every scenario must center on your motivation, but it remains a consistent background element
- The motivation-aligned choice should feel authentic and meaningful to your character's goal

## Failure System

### Game Over Conditions

The game ends immediately in failure when:
- You select the deadly choice during any turn (1, 2, 3, 4, or 5)
- This is the **only** way to lose the game
- No other failure conditions exist (no resource depletion, time limits, or secondary loss states)

### Death & Deadly Choice Resolution

When you select a deadly choice, the following occurs:

1. **Causal Death Narrative**: The AI generates **a full paragraph (3-4 sentences minimum)** that describes both:
   - **How** your chosen action led to death (the specific causal chain of events)
   - **Why** this particular choice was fatal (what factors made it deadly vs. the alternatives)
   
   This detailed narrative creates coherence between the choice you made and the fatal outcome. The death is not arbitrary - the AI explains the logical connection between your action and the lethal consequence in paragraph form. The explanation should make narrative sense within the context of the scenario, your choice, and the dangerous frontier setting.

2. **Game Over Display**: After the death narrative, the game clearly indicates that:
   - You have died
   - Your westward journey has ended
   - The game is over (no continuation possible)

3. **Progress Loss**: Your current game progress is completely lost:
   - You do not continue from where you died
   - You cannot replay the fatal turn
   - All progress through previous turns is erased

4. **Final Statistics**: The game displays:
   - **Turn of Death**: Which turn you died on (Turn 1, 2, 3, 4, or 5)
   - **Character Motivation**: Your character's motivation for going west (the one revealed at game start)
   - **Brief Epitaph**: A short concluding statement or summary about your character's failed journey

### Restart Options

After failure, you may restart by:
- **Manually Exiting and Relaunching**: To start a new game, you must completely exit the current game instance and launch the game again. There is no "New Game" button or restart mechanism within the game interface. This reinforces the finality of each playthrough - you must leave the game entirely and return to begin fresh.

**New Game Properties**:
- Each relaunched game begins with a completely fresh, newly generated random motivation
- All scenarios, choices, and outcomes are procedurally generated anew
- No content, knowledge, or progress from previous games carries over
- The game does not track, save, or display outcomes from previous playthroughs
- Each new game is a completely independent experience

**No Retained Knowledge**: The game does not retain any progress, choices, narrative outcomes, or knowledge from previous attempts. You start fresh with no reference to prior deaths or victories.

## Victory Condition

### Winning the Game

You achieve victory by:
- Successfully making non-deadly choices on all 5 turns
- Completing Turn 5 without selecting the deadly choice
- Reaching the western coast alive

### Victory Requirements

**Mandatory**:
- Survive all 5 turns by avoiding the deadly choice each turn
- Make the final choice on Turn 5 successfully (select one of the 3 safe choices)

**Not Required for Victory**:
- You do NOT need to select the motivation-aligned choice every turn (or any turn)
- You do NOT need to optimize narrative outcomes or achieve the best possible results
- You do NOT need to successfully pursue or fulfill your character's motivation
- Simply surviving and reaching the coast is sufficient for victory

### Victory Resolution

When you successfully complete Turn 5 without dying:

1. **Final Arrival Narrative**: The AI generates **a paragraph-length narrative** describing:
   - Your arrival at the western coast
   - The conclusion of your physical journey
   - The end of immediate survival challenges
   - A vivid, satisfying description of reaching your destination

2. **Motivation Resolution**: The narrative addresses:
   - Whether you have achieved your original motivation or are now positioned to pursue it
   - What your character's situation is regarding their reason for going west
   - A sense of closure (positive, negative, or ambiguous) regarding your character's personal goal

3. **Victory Display**: The game clearly indicates:
   - You have won
   - You successfully reached the west coast alive
   - Your journey is complete

4. **Concluding Statement**: The AI generates **a paragraph-length final statement** (multiple sentences) about your character's fate or future at the western coast. This conclusion provides substantial narrative closure and a sense of achievement, reflecting on your journey and what lies ahead for your character.

### Victory as Binary Outcome

Victory is **binary** - you either reach the west coast alive (win) or die during the journey (lose). There are no:
- Graduated success levels
- Partial victories
- Quality ratings
- Performance scores
- Metrics tracking how many motivation-aligned choices you made
- Degrees of success beyond win/loss

The game does not track or display statistics about choice quality, optimal paths, or narrative outcomes. Reaching the coast alive is the single victory condition.

**Narrative Quality Variations**: While victory itself is binary, the narrative quality and content of your ending will vary based on:
- Which specific safe choices you made during the journey
- Whether you selected motivation-aligned choices (reflected in narrative, not score)
- The procedurally generated story path your choices created
- Whether your final position allows you to pursue your original motivation

These variations affect only the narrative content of the victory, not whether you mechanically won the game. All victories are equal in mechanical terms.

### Post-Victory Restart

After achieving victory, you may start a new game by:
- **Manually Exiting and Relaunching**: Just as with failure, you must completely exit the game and launch it again to begin a new playthrough. There is no "New Game" button after victory. This maintains consistency with the failure restart mechanism and emphasizes the finality of each complete journey.

## Procedural Narrative System

### AI-Generated Content

The game uses AI to generate all narrative content fresh and on-the-spot for each playthrough. **No content is pre-written, templated, or selected from a fixed pool.**

**What the AI Generates Each Turn**:

1. **Scenario Description**: A unique narrative describing your current situation, location, immediate challenge, and relevant context. This description is written specifically for this turn of this playthrough, incorporating your motivation and previous choices where appropriate.

2. **Four Choice Descriptions**: Four distinct single-sentence descriptions of different actions your character can take. Each choice is written as unique prose specific to the current scenario - not generic options or templated text.

3. **Outcome Narrative**: After you select a choice, the AI generates a consequence narrative that:
   - **For Safe Choices**: 1-2 sentences explaining what happens as a result of your specific chosen action, describing immediate and relevant consequences
   - **For Deadly Choices**: A full paragraph (3-4 sentences minimum) explaining the detailed causal chain from choice to death
   - **For Victory**: Paragraph-length narratives for both the arrival description and the final concluding statement
   - Maintains narrative coherence with the scenario and choice

**AI Generation Parameters**:

The AI creates content while maintaining coherence through consideration of:

**Motivation Integration**:
- Your specific random motivation (revealed at game start) guides narrative themes
- Scenarios may reference, incorporate, or directly involve your reason for going west
- The motivation-aligned choice must authentically connect to your character's goal
- Not every scenario must center on your motivation, but it remains a consistent background element
- The AI ensures narrative respect for your character's driving purpose

**Geographic Progression**:
The AI generates scenarios appropriate to your position in the westward journey:
- **Turn 1**: Eastern settlements, departure points, or transition from civilization to frontier
- **Turn 2**: Open prairies, grasslands, early wilderness, or initial frontier territories
- **Turn 3**: Mountain passes, major rivers, difficult terrain, or significant geographic obstacles
- **Turn 4**: Deserts, hostile territories, lawless regions, or extreme environmental challenges
- **Turn 5**: Final approach to western territories, coast proximity, or ultimate obstacles before destination

**Encounter Variety**:

The AI may generate scenarios involving:
- **Environmental Hazards**: Weather extremes, terrain dangers, natural disasters, wildlife threats
- **Human Encounters**: Bandits, outlaws, settlers, indigenous peoples, lawmen, fellow travelers, merchants, opportunists
- **Resource Challenges**: Food scarcity, water shortage, equipment failure, shelter needs, medical emergencies
- **Social Situations**: Conflict resolution, trading/bartering, persuasion, leadership decisions, trust dilemmas
- **Supernatural Elements**: Only when fitting your motivation (e.g., curse-related encounters for curse motivation), maintaining frontier folklore tone
- **Time-Sensitive Decisions**: Urgent situations requiring quick judgment
- **Moral Dilemmas**: Choices between competing values or difficult ethical decisions
- **Physical Challenges**: Tests of strength, endurance, or survival skills
- **Information/Navigation**: Route selection, guide selection, map interpretation

**Narrative Coherence**:
- Later turns may reference outcomes of earlier choices to maintain story continuity
- Your survival methods and choices establish your character's capabilities and reputation
- The world remains consistent with western frontier themes and historical/mythological period (roughly 1840s-1880s)
- Tone balances danger with hope, grim reality with determination
- The narrative respects both the stakes of survival and the goal of reaching the west

### Replayability

Each new game provides completely unique content:

- **Different Random Motivation**: 1 of 10 possible motivations selected randomly
- **Fresh Procedural Scenarios**: All 5 scenarios are AI-generated anew - never repeated from previous games
- **Unique Choice Descriptions**: All 20 total choices (4 per turn × 5 turns) are freshly written
- **Randomized Deadly Choices**: The deadly choice position and nature change every playthrough
- **Varied Narrative Paths**: Your decisions create unique story paths that differ each game
- **No Repeated Content**: The AI does not reuse descriptions, choices, or outcomes from previous playthroughs

**Knowledge from Previous Games**: Information from past playthroughs provides no mechanical advantage:
- Deadly choices are completely randomized each game
- Scenarios are generated fresh and do not repeat
- Pattern recognition cannot predict deadly choices
- Each game must be played on its own merits

## Turn Details & Gameplay Flow

### Turn 1: The Journey Begins

**Context**: You have just begun your westward journey. You're still in relatively settled eastern territories or have recently departed from civilization. The frontier lies ahead.

**Typical Scenario Elements**:
- Choosing your traveling method, route, or companions
- Deciding how to handle initial supplies, equipment, or preparations
- Responding to early encounters with other travelers, merchants, or authorities
- Navigating first obstacles, challenges, or complications
- Establishing your character's approach to survival

**Geographic Setting**: Towns, settlements, outposts, departure points, edges of civilization, early trails

**Stakes**: Establishing your character's capabilities, approach, and commitment to the dangerous journey ahead

### Turn 2: The Open Frontier

**Context**: You've entered the open frontier - prairies, grasslands, or early wilderness territories. Civilization is behind you. You're committed to the journey now.

**Typical Scenario Elements**:
- Managing resources across vast, empty distances
- Encountering frontier dangers (weather, wildlife, isolation, exposure)
- Meeting other travelers with unknown intentions or reliability
- Making navigation decisions across featureless terrain
- Dealing with the psychological challenges of isolation

**Geographic Setting**: Prairies, grasslands, plains, river crossings, early frontier, sparse settlements

**Stakes**: Committing to the harsh realities of the journey and demonstrating survival competence

### Turn 3: Major Obstacles

**Context**: You face significant geographic or situational challenges - mountain passes, major rivers, dangerous territories, or critical survival tests. This is often the turning point where the journey becomes most difficult.

**Typical Scenario Elements**:
- Overcoming extreme terrain or environmental hazards
- Navigating through hostile, contested, or dangerous territories
- Dealing with equipment failure, resource depletion, or physical exhaustion
- Confronting significant human threats or conflicts
- Making high-stakes decisions under pressure

**Geographic Setting**: Mountains, deep wilderness, major rivers, canyons, hostile territories, extreme terrain

**Stakes**: The most difficult survival challenges - this turn tests whether you have the judgment and fortune to continue

### Turn 4: The Lawless West

**Context**: You're deep in western territories where civilization's rules barely apply. You're close to your goal but in maximum danger. Desperation and opportunity coexist.

**Typical Scenario Elements**:
- Encounters with outlaws, desperados, corrupt authorities, or violent opportunists
- Survival in harsh desert, extreme climates, or resource-poor environments
- Desperation situations involving scarce resources or impossible choices
- High-stakes conflicts, confrontations, or moral dilemmas
- Testing whether your motivation remains stronger than the temptation to quit

**Geographic Setting**: Deserts, lawless territories, outlaw havens, extreme western wilderness, dangerous settlements

**Stakes**: Final tests of your survival skills, moral character, and commitment to reaching the coast

### Turn 5: Journey's End

**Context**: The western coast is within reach or at least achievable. This is your last major obstacle before achieving your goal. Victory or death - one more choice determines everything.

**Typical Scenario Elements**:
- Final approach challenges or last obstacles
- Complications related to your motivation emerging at the end
- Ultimate tests of character, judgment, or survival
- Reaching or failing to reach the destination
- Resolution of your journey's purpose

**Geographic Setting**: Western territories, approach to coast, final frontier, Pacific territories, coastal regions

**Stakes**: This is the final turn - survive this choice and you reach the west coast and win; choose wrongly and your entire journey ends in death

## Constraints & Special Rules

### Mandatory Game Elements

**Fixed Turn Count**:
- The game is always exactly **5 turns**
- No scenarios can extend or shorten the journey length
- Turn count does not vary between playthroughs or for any reason
- Every game follows the exact sequence: Turn 1 → 2 → 3 → 4 → 5

**Fixed Choice Count**:
- Every turn presents exactly **4 choices**
- No scenarios offer more or fewer options
- Choice count does not vary within or between games
- This count never changes for any reason

**One Deadly Choice Per Turn**:
- Each turn has exactly **1 deadly choice** and exactly **3 safe choices**
- This ratio is fixed and never changes
- Multiple deadly choices per turn are not allowed
- Zero deadly choices per turn is not allowed

**Single Life System**:
- You have exactly **1 life** per playthrough
- No respawns, continues, extra lives, or second chances exist
- Death is permanent and ends the game immediately
- No game mechanics can restore life or resurrect your character

### Gameplay Constraints

**No Take-Backs**:
- Once you select a choice, it cannot be undone, reversed, or changed
- The outcome is immediately revealed and permanently locked in
- You cannot replay, restart, or redo individual turns
- No "undo" functionality exists

**No Save/Load System**:
- The game does not save progress mid-game
- No checkpoints, save points, or progress markers exist
- Each playthrough must be completed in one continuous session
- Closing or quitting the game ends your current attempt permanently
- You cannot resume a game in progress

**No Hints, Warnings, or Indicators**:
- The game does not mark, flag, or indicate which choice is deadly
- No warnings, alerts, or hints appear before selecting any choice
- No visual cues, formatting differences, or meta-information distinguish deadly from safe choices
- You receive no indication (beyond narrative context) of which choice aligns with your motivation
- No tooltips, help text, or explanatory notes appear during choice selection
- The game provides no mechanical information about choice outcomes

**Linear Progression**:
- You cannot skip turns or jump ahead
- You cannot return to or replay previous turns
- The journey only moves forward (Turn 1 → 2 → 3 → 4 → 5)
- There are no branching paths that affect turn order or count
- No shortcuts or alternative routes exist

**No Player History or Statistics**:
- The game does not track or display outcomes from previous playthroughs
- No history, statistics, records, or archives of past games exist
- Each new game has no reference to or knowledge of previous attempts
- No "game over" screens reference previous deaths or victories
- No achievements, unlocks, or persistent progression exist between games

**Manual Restart Mechanism**:
- After a game ends (in either death or victory), there is no "New Game" button or restart option within the game interface
- To start a new game, you must completely exit the current game instance and launch the game again
- This manual restart requirement reinforces the finality of each playthrough
- The game does not provide any in-game mechanism to begin a fresh journey

### Narrative Constraints

**Motivation Consistency**:
- Your character's motivation never changes during a playthrough
- All scenarios generated must respect and acknowledge the established motivation
- The motivation-aligned choice must be thematically authentic to your specific motivation
- The motivation remains consistent from game start to game end (or death)

**Western Frontier Theme**:
- All content must fit the historical/mythological American western frontier setting
- Scenarios should feel appropriate to roughly the 1840s-1880s era
- Technology and culture should match the period (no anachronisms)
- Supernatural elements (curses, hauntings, legends) are allowed **only** when tied to specific motivations that involve them
- Supernatural content maintains the tone of frontier folklore and myth, not fantasy or horror genres
- Geographic locations should be plausible for westward American expansion routes

**Death Plausibility**:
- Deadly choices must result in narratively justified deaths
- Deaths should feel like reasonable and logical consequences of the chosen action
- The causal link between choice and death must be explainable and coherent in a full paragraph
- Arbitrary, illogical, or nonsensical deaths are not allowed
- The deadly choice should represent a genuine strategic option that happens to be fatal
- Death narratives must explain in detail why this choice was deadly while others were survivable

**AI Content Quality**:
- Generated scenarios must be specific, detailed, and unique (not generic or vague)
- Choice descriptions must be distinct single sentences describing clear actions
- Outcomes must logically follow from choices made
- Narrative prose should maintain consistent tone and quality throughout
- Descriptions should create vivid, engaging frontier scenarios
- Safe choice outcomes are 1-2 sentences; deadly choice outcomes are full paragraphs (3-4+ sentences)
- Victory narratives are paragraph-length for both arrival and conclusion

## Edge Cases & Clarifications

### Motivation-Deadly Choice Interaction

**Question**: Can the motivation-aligned choice ever be the deadly choice?  
**Answer**: **No, never**. The motivation-aligned choice is always one of the 3 safe choices. Your character's core motivation should not directly lead to death. This is a mandatory game constraint.

### All Choices Appear Risky

**Question**: What if all 4 choices seem equally dangerous or risky?  
**Answer**: This is intentional and part of the game's design. In a dangerous westward journey, all options carry apparent risk. Three choices are survivable despite appearing risky; one is genuinely fatal. You must use judgment, narrative intuition, and consideration of your motivation to assess which risks are acceptable and which are deadly. The game does not guarantee that safe choices will appear obviously safe.

### Motivation Not Immediately Obvious

**Question**: What if I can't identify which choice aligns with my motivation?  
**Answer**: The motivation-aligned choice should be recognizable through narrative context and consideration of your character's revealed motivation, but it may not always be immediately obvious. You are **not required** to select the motivation-aligned choice to survive or win - you only need to avoid the deadly choice. The motivation-aligned choice affects narrative quality but not survival.

### Identical-Seeming Choices

**Question**: What if two or more choices seem very similar or nearly identical?  
**Answer**: The AI should generate distinct choices, but if ambiguity occurs, you must make your best judgment. Each choice has a unique outcome even if descriptions seem similar. Read carefully for subtle differences in approach, method, or implication. This ambiguity may be part of the challenge.

### Victory Without Motivation Success

**Question**: What if I reach the west coast alive but my character cannot pursue or achieve their original motivation?  
**Answer**: You still **win** the game. Victory mechanically requires only reaching the coast alive, not necessarily achieving your character's personal goal. The victory narrative may address your motivation's status (fulfilled, achievable, or failed), but mechanical victory is binary and based solely on survival. Narrative outcome varies, but winning is determined only by survival.

### Restart After Death or Victory

**Question**: Can I immediately start a new game after death or victory?  
**Answer**: You can start a new game, but you must manually exit the current game instance completely and launch the game again. There is no "New Game" button or restart option within the game interface. This manual restart requirement applies to both failure (death) and victory outcomes, reinforcing the finality of each complete playthrough.

### Memorizing Deadly Choices

**Question**: Can I memorize the deadly choices and replay with an advantage?  
**Answer**: **No**. Each new game procedurally generates entirely new scenarios with newly randomized deadly choice placements. Knowledge from previous games provides no mechanical advantage because:
- Scenarios are AI-generated fresh each game and never repeat
- Deadly choice positions are randomized each game
- The deadly choice in a similar-seeming scenario may be different
- Pattern recognition cannot predict future deadly choices

### Mid-Game Quit

**Question**: What happens if I close the game during a playthrough?  
**Answer**: Your current game progress is lost permanently. There is no save system. You must start a completely new game (by relaunching) if you want to play again. The game does not preserve mid-playthrough state.

### Narrative References to Past Turns

**Question**: Can later turns reference my choices from earlier turns?  
**Answer**: Yes. Within a single playthrough, later turn scenarios may reference or acknowledge outcomes from earlier turns to maintain narrative coherence. However, new games never reference previous playthroughs.

### Supernatural Content Restrictions

**Question**: When can supernatural elements appear in scenarios?  
**Answer**: Supernatural elements (curses, hauntings, mystical phenomena) may appear **only** when your character's motivation involves supernatural themes (e.g., "Escaping a supernatural curse or haunting"). If your motivation is mundane (e.g., seeking gold, fleeing the law), scenarios should not include supernatural content. Supernatural elements maintain the tone of frontier folklore and tall tales, not fantasy or horror genres.

### Equal Difficulty Across Turns

**Question**: Is each turn equally difficult, or do later turns get harder?  
**Answer**: Each turn presents exactly 1 deadly choice among 4 options, so the mechanical difficulty (25% chance of random death) is identical. However, narrative stakes and tension may escalate across turns as you get closer to your goal and face more extreme frontier challenges. The final turn's narrative weight is higher because it's your last obstacle before victory.

### Choice Length Consistency

**Question**: Why are choices single sentences while outcomes vary in length?  
**Answer**: Single-sentence choices force clarity and make decision-making faster and more immediate. You don't need extensive descriptions to understand what action you're taking. However, outcomes require more detail: safe outcomes need 1-2 sentences to show consequences; deadly outcomes need full paragraphs (3-4+ sentences) to properly explain the causal chain of death; victory needs paragraph-length narratives to provide satisfying closure. This asymmetry is intentional - quick choices, detailed consequences.

## Summary of Win/Loss Conditions

### You Win When:
- You successfully complete all 5 turns without dying
- You make the final choice on Turn 5 and it is not the deadly choice
- You reach the western coast alive
- Victory narrative (paragraph-length arrival and conclusion) is displayed

### You Lose When:
- You select the deadly choice on any turn (1, 2, 3, 4, or 5)
- Your character dies (for any reason caused by selecting the deadly choice)
- Your journey ends prematurely before reaching Turn 5 completion
- Death narrative (full paragraph explaining causation) and game over screen are displayed

### Victory is Determined By:
- **Survival only** - reaching the coast alive
- **NOT** by narrative quality or optimal choices
- **NOT** by selecting motivation-aligned choices (any number from 0-5)
- **NOT** by achieving your character's personal goal or motivation
- **NOT** by score, statistics, or performance metrics

### No Other Outcomes:
- No draws, stalemates, or ties exist
- No partial victories or degrees of success exist
- No alternative endings beyond binary win/loss exist
- The game is complete when either victory or failure conditions are met

## Implementation Guidance

### State Management for Deadly Options

**CRITICAL**: The game must store which choice index is deadly for each turn in the game state to enable deterministic precondition checking.

**Required State Field**:
- The game state MUST include an array field that stores the deadly choice index for each turn
- Example field name: `game.deadlyChoiceIndexPerTurn: number[]` (5 elements, one per turn)
- This array MUST be initialized during game setup with 5 randomly selected indices (0-3)
- Each turn's deadly choice index should be determined once and stored, not recalculated

**Initialization**:
- During game initialization, generate 5 random numbers (each 0-3) representing the deadly choice for turns 1-5
- Store these in the deadly choice array: `[deadlyTurn1, deadlyTurn2, deadlyTurn3, deadlyTurn4, deadlyTurn5]`
- Example: `[2, 1, 3, 0, 2]` means turn 1's deadly choice is index 2, turn 2's is index 1, etc.

**Precondition Usage**:
- Transitions that check if a choice was deadly MUST use the `lookup` operation to access the array
- Example: `{"lookup": [{"var": "game.deadlyChoiceIndexPerTurn"}, {"-": [{"var": "game.currentTurn"}, 1]}]}`
- This retrieves the deadly choice index for the current turn (using turn-1 for 0-based array indexing)
- Compare the player's selected choice index against the retrieved deadly index

**Why This Is Required**:
- Preconditions must be deterministic (cannot rely on AI generation or randomness at transition time)
- Storing deadly indices once allows transitions to check "was this choice deadly?" using pure logic
- The `lookup` operation enables dynamic array access using the current turn number as an index
