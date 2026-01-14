/**
 * Test: Generate skeleton spec from game concept
 * 
 * This validates whether an LLM can:
 * 1. Take a brief game concept
 * 2. Generate a structural skeleton with all required elements
 * 3. Correctly identify where narrative markers should go
 * 4. Distinguish structural requirements from narrative guidance
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupModel } from '#chaincraft/ai/model-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateSkeleton(gameConceptSummary: string): Promise<string> {
  const prompt = `You are a game specification writer creating a SKELETON specification.

A skeleton spec contains ALL game rules and mechanics, but uses MARKERS for lengthy narrative guidance sections that will be filled in later by a separate process.

**Game Concept:**
${gameConceptSummary}

---

**WHAT TO INCLUDE INLINE (write these sections fully):**

Write a comprehensive markdown document covering:

- **Game Overview**: What is the game about? Core objective?
- **Initial Setup**: What do players start with? How is the game prepared?
- **Gameplay Flow**: How does the game progress? (turns, rounds, phases, etc.)
- **Player Actions**: What can players do and when? What are the effects?
- **Game Mechanics**: Special rules, resource management, movement, etc.
- **Constraints & Edge Cases**: Important limitations, timing rules, tie-breaking
- **Winning & Losing**: How does the game end? How are winners determined?

Choose section names and structure that fit this specific game type.

**Quality Standards:**
1. **Completeness**: Cover ALL game rules - don't leave gaps
2. **Specificity**: Use exact numbers, quantities, and conditions
3. **Clarity**: Rules should be unambiguous
4. **Playability**: Someone should understand how to play from this spec

**Focus on RULES, not implementation** - describe what happens in the game, not how to code it. Don't describe state fields, data structures, or implementation details.

---

**WHAT TO MARK (use markers instead of writing):**

For sections that require LENGTHY narrative guidance, examples, or style direction, use:

\`\`\`
<!-- NARRATIVE:KEY_NAME -->
\`\`\`

Where KEY_NAME is UPPERCASE_SNAKE_CASE.

**Examples of what needs markers:**

1. **Tone & Style Guidance** (if game involves narrative/story):
   - "Write scenarios with gritty atmosphere..."
   - "Maintain period-appropriate language..."
   → Use: \`<!-- NARRATIVE:TONE_STYLE -->\`

2. **Content Generation Examples** (for AI-generated content):
   - "Example scenarios that work well..."
   - "Choice design patterns with examples..."
   → Use: \`<!-- NARRATIVE:SCENARIO_GENERATION_GUIDE -->\`

3. **Flavor Text Guidelines**:
   - "Card descriptions should evoke..."
   - "Victory messages should feel..."
   → Use: \`<!-- NARRATIVE:FLAVOR_TEXT_STYLE -->\`

4. **Turn-by-Turn Narrative Guides** (for progressive games):
   - "Turn 1: Eastern settlements with X atmosphere..."
   - "Turn 5: Final approach with Y tension..."
   → Use: \`<!-- NARRATIVE:TURN_X_GUIDE -->\`

**DO NOT use markers for:**
- Core game rules
- Exact numbers and mechanics
- Win/loss conditions
- State requirements
- Brief explanatory text

---

**Example from a card game:**

## Card Types

**Attack Cards**:
- Deal 2-5 damage to target opponent
- Cost: 1-3 energy to play
- Can only be played during your turn

**Narrative Style for Card Descriptions**:
<!-- NARRATIVE:CARD_FLAVOR_STYLE -->

---

Generate the complete skeleton specification now (markdown only, no JSON, no code fences around the whole thing):`;

  console.log('Generating skeleton from game concept...\n');

  const model = await setupModel({
    modelName: 'claude-sonnet-4-20250514',
    maxTokens: 8000
  });

  const response = await model.invokeWithSystemPrompt(
    prompt,
    undefined,
    { runName: 'generate-skeleton' }
  );

  return response.content || '';
}

describe('Skeleton Generation from Game Concept', () => {
  it('should generate a valid skeleton spec from concept', async () => {
    const gameConceptSummary = `Westward Peril: A single-player survival game where players navigate 5 dangerous turns on a westward journey across the American frontier (1840s-1880s setting). 

Core Mechanics:
- 5 sequential turns (fixed count)
- Each turn presents exactly 4 choices (1 deadly, 3 safe)
- 1 of the 3 safe choices is "motivation-aligned" 
- Player has 1 life (death = immediate game over)
- Random motivation selected at game start (1 of 10 options like "fleeing the law", "seeking fortune", etc.)
- Deadly choice position is randomized and stored in state each game

Victory: Survive all 5 turns
Defeat: Select the deadly choice on any turn

State Requirements:
- currentTurn (1-5)
- isAlive (boolean)
- motivation (enum)
- deadlyChoiceIndexPerTurn (array of 5 indices, each 0-3)

AI Generation:
- All scenarios, choices, and outcomes are procedurally generated by AI each playthrough
- Content should feel dangerous, consequential, and period-appropriate
- No pre-written templates or fixed content pools

Key Constraints:
- No save/load system
- No hints or warnings about which choice is deadly
- Linear progression only (no branching paths)
- Motivation-aligned choice is always safe (never deadly)
- Death outcomes require full paragraph explaining causation`;

    console.log('Game Concept Summary:');
    console.log(gameConceptSummary);
    console.log('\n' + '='.repeat(80) + '\n');

    const skeleton = await generateSkeleton(gameConceptSummary);

    console.log(`Generated skeleton: ${skeleton.split(' ').length} words`);
    console.log(`Estimated tokens: ~${Math.round(skeleton.length / 4)}\n`);

    // Count narrative markers
    const markerMatches = skeleton.match(/<!-- NARRATIVE:\w+ -->/g);
    const markerCount = markerMatches ? markerMatches.length : 0;
    console.log(`Narrative markers found: ${markerCount}`);
    if (markerMatches) {
      console.log('Markers:', markerMatches.join(', '));
    }

    // Save results
    const outputPath = path.join(__dirname, '../test-results/skeleton-generation-test.md');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const markdown = `# Skeleton Generation Test Results

## Game Concept Summary

${gameConceptSummary}

## Generated Skeleton

**Word Count**: ${skeleton.split(' ').length}
**Narrative Markers**: ${markerCount}
${markerMatches ? `**Markers Used**: ${markerMatches.join(', ')}` : ''}

---

${skeleton}

---

## Validation Checklist

### Structural Requirements (should be inline):
- [ ] Game overview and core objective
- [ ] Turn count (5 turns fixed)
- [ ] Choice count (4 per turn)
- [ ] Deadly/safe choice ratio (1 deadly, 3 safe)
- [ ] State schema (currentTurn, isAlive, motivation, deadlyChoiceIndexPerTurn)
- [ ] Win condition (complete all 5 turns)
- [ ] Loss condition (select deadly choice)
- [ ] Motivation list (10 options)
- [ ] Implementation guidance for preconditions
- [ ] Constraints (no saves, no hints, linear progression)

### Narrative Markers (should use markers):
- [ ] Tone and narrative style guidance
- [ ] AI generation parameters and guidelines
- [ ] Turn-by-turn scenario guidance (Turns 1-5)
- [ ] Choice design principles with examples
- [ ] Procedural generation details
- [ ] Edge cases narrative explanations

### Quality Checks:
- [ ] Skeleton is focused and concise (not verbose)
- [ ] Structural requirements are complete and clear
- [ ] Narrative markers are appropriately placed
- [ ] No lengthy examples or flavor text inline
- [ ] Clear section organization
- [ ] Implementation guidance is actionable

## Comparison to Hand-Crafted Skeleton

See: \`tests/games/specs/westward-peril-skeleton.md\`

Compare:
- Structure completeness
- Marker placement
- Word count efficiency
- Clarity of requirements
`;

    await fs.writeFile(outputPath, markdown);

    console.log('\nResults saved to:');
    console.log(`  ${outputPath}`);
    console.log('\nNext step: Compare generated skeleton to hand-crafted skeleton');
    console.log(`  tests/games/specs/westward-peril-skeleton.md`);

    expect(skeleton).toBeTruthy();
    expect(skeleton.length).toBeGreaterThan(1000);
    expect(markerCount).toBeGreaterThan(0);
  });
});
