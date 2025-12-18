# Space Odyssey: A Choice-Based Survival Game

## Game Overview

Space Odyssey is a single-player, narrative-driven choice game where you take on the role of a space explorer navigating through dangerous scenarios across the cosmos. Your mission is to survive 5 consecutive rounds of critical decisions, where each wrong choice could mean instant death in the void of space.

The game tests your judgment, intuition, and luck as you face equipment malfunctions, hostile encounters, environmental hazards, and navigational challenges. Each round presents you with 3-5 different options, but beware—one choice in each round is deadly and will immediately end your journey.

**Core Objective:** Successfully complete all 5 rounds by making safe choices and avoiding the single deadly option hidden in each round.

## Initial Setup

### Game Preparation

1. **Round Counter**: Set the current round to Round 1
2. **Player Status**: The player begins alive and ready to make their first choice
3. **Deadly Option Assignment**: For each of the 5 rounds, randomly designate one option as the deadly choice
   - This randomization occurs at game start
   - The deadly option's position must be different across playthroughs to ensure replayability
   - Players cannot see which option is deadly until they select it

### Starting Conditions

- The player begins with no prior knowledge of which choices are safe or deadly
- No resources, equipment, or stats need to be tracked—only survival status and round progression
- The game presents the first scenario immediately upon starting

## Game Structure

### Round Progression

The game consists of exactly 5 sequential rounds:

1. **Round 1**: The player faces their first scenario
2. **Round 2**: Available only after successfully completing Round 1
3. **Round 3**: Available only after successfully completing Round 2
4. **Round 4**: Available only after successfully completing Round 3
5. **Round 5**: The final round—success here means victory

There are no branching paths or alternate routes. Every player experiences the same linear progression through rounds, though the specific scenarios and choice arrangements may vary.

### Round Structure

Each round follows this structure:

1. **Scenario Presentation**: A narrative description of the current challenge or situation
2. **Choice Options**: Between 3 and 5 distinct choices are presented to the player
3. **Player Selection**: The player selects exactly one option
4. **Outcome Resolution**: The game immediately reveals whether the choice was safe or deadly

## Gameplay Flow

### Turn-Based Choice System

The game operates on a simple choice-response cycle:

1. **Scenario Display**: The current round's scenario is presented with narrative context
2. **Option Review**: The player reviews all available choices (3-5 options)
3. **Selection Phase**: The player selects exactly one option
4. **Immediate Resolution**: The game instantly processes the choice
5. **Outcome**: The result is revealed immediately

There are no time limits, no simultaneous choices, and no ability to change your selection once confirmed.

### Round Advancement

**After a Safe Choice:**
- A success message is displayed confirming the player survived
- Brief narrative describes the outcome of the safe choice
- The round counter increments by 1
- The next round's scenario is presented immediately
- The player receives no other bonuses or penalties

**After a Deadly Choice:**
- A failure message is displayed explaining how the choice led to death
- The game ends immediately in a loss condition
- The player is informed which round they failed on
- No further rounds are presented
- The player may restart the game from Round 1

### Information Visibility

**What Players Know:**
- The current round number (1-5)
- The scenario description for the current round
- All available choice options for the current round
- The outcome of their previous choices (if any)

**What Players Don't Know:**
- Which option is deadly in the current round
- Which options will be deadly in future rounds
- The specific scenarios of rounds they haven't reached
- The total number of choices in future rounds

## Player Actions

### Primary Action: Making a Choice

On each round, the player must perform exactly one action: **select one of the available options**.

**Selection Requirements:**
- The player must choose exactly one option—no skipping, no multiple selections
- Once an option is selected and confirmed, it cannot be changed
- The player cannot proceed without making a choice
- All options must be clearly distinguishable from one another

**Choice Characteristics:**
- Each option represents a distinct course of action
- Options are mutually exclusive—choosing one precludes the others
- All options (except the deadly one) lead to the same outcome: survival and round advancement
- The deadly option always results in immediate game loss

### No Additional Actions

The player has no other actions available:
- No inventory management
- No character customization
- No resource gathering
- No backtracking to previous rounds
- No hints or help systems
- No ability to preview future scenarios

## Choice Distribution

### Number of Options Per Round

Each round presents between 3 and 5 distinct choices:

- **Minimum Options**: 3 (one deadly, two safe)
- **Maximum Options**: 5 (one deadly, four safe)
- The specific number can vary between rounds to maintain variety
- The number of options does not indicate difficulty or danger level

### Deadly Option Properties

In every round, exactly one option is designated as deadly:

**Deadly Option Rules:**
- There is always exactly 1 deadly option per round—never 0, never more than 1
- The deadly option immediately ends the game when selected
- The deadly option is not marked or distinguished from safe options
- The deadly option's position among the choices is randomized
- The deadly option does not follow predictable patterns (not always first, last, or middle)

### Safe Option Properties

All non-deadly options are considered safe:

**Safe Option Rules:**
- Selecting any safe option allows the player to survive the round
- All safe options in a round have the same mechanical outcome: advancement to the next round
- Safe options may have different narrative outcomes, but all result in survival
- The number of safe options in a round equals (Total Options - 1)

## Game Mechanics

### Randomization System

**Deadly Option Placement:**
- At the start of each new game, the deadly option for each round is randomly assigned
- This assignment happens before the player sees any scenarios
- The randomization must ensure variety across multiple playthroughs
- No two playthroughs should have identical deadly option patterns

### No Memory or Learning Benefits

The game does not reward memorization:

- Scenario content may vary between playthroughs (optional)
- Even if scenarios repeat, the deadly option position changes
- Players cannot "learn" the safe path through memorization alone
- Each playthrough requires fresh decision-making

### No Probability Indicators

The game provides no statistical information:

- Players don't know the odds of selecting the deadly option
- No indicators show which choices are "more likely" to be safe
- All options appear equally viable based on presentation alone
- Players must rely on narrative context, intuition, or chance

## Winning Condition

### Victory Requirements

The player achieves victory by satisfying ALL of the following conditions:

1. **Complete Round 1** by selecting a safe option
2. **Complete Round 2** by selecting a safe option
3. **Complete Round 3** by selecting a safe option
4. **Complete Round 4** by selecting a safe option
5. **Complete Round 5** by selecting a safe option and surviving

Upon completing all 5 rounds, the player achieves victory and the game ends in a win condition.

## Losing Condition

The player loses if they select the deadly option in any round. Upon selecting the deadly option:
- The game immediately ends
- A failure message explains the outcome
- The player's run is over
- The player may start a new game from Round 1
