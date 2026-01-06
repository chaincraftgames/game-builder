/**
 * Test: Generate narratives from skeleton spec
 * 
 * This script tests whether we can:
 * 1. Generate high-quality narrative sections from a structural skeleton
 * 2. Maintain coherence across independently generated narratives
 */

import fs from 'fs/promises';
import path from 'path';
import { setupModel } from '../src/ai/model-config.js';

interface GenerationResult {
  key: string;
  content: string;
}

async function generateNarrative(
  skeletonSpec: string,
  narrativeKey: string,
  previousNarratives: GenerationResult[] = []
): Promise<GenerationResult> {
  // Replace the marker with a placeholder so the model knows where to fill in
  const specWithPlaceholder = skeletonSpec.replace(
    `<!-- NARRATIVE:${narrativeKey} -->`,
    `<!-- NARRATIVE:${narrativeKey} -->\n[GENERATE CONTENT HERE]`
  );

  // Inject previously generated narratives into the skeleton
  let workingSpec = specWithPlaceholder;
  for (const prev of previousNarratives) {
    workingSpec = workingSpec.replace(
      `<!-- NARRATIVE:${prev.key} -->`,
      prev.content
    );
  }

  const prompt = `You are filling in narrative guidance sections for a game specification.

GAME SUMMARY:
Westward Peril - A single-player survival game where players navigate 5 dangerous 
turns on a westward journey. Each turn presents 4 choices (1 deadly, 3 safe). 
Victory requires surviving all 5 turns by avoiding deadly choices.

GLOBAL NARRATIVE GUIDELINES:
- This is a western frontier survival game (1840s-1880s era)
- Narrative guidance is for runtime LLMs that generate story content
- Be comprehensive - provide examples, explain good vs poor approaches
- Maintain consistency with game's structural requirements
- All generated game content should feel dangerous, consequential, and frontier-authentic

SKELETON SPECIFICATION WITH MARKERS:
${workingSpec}

TASK:
Find the marker "<!-- NARRATIVE:${narrativeKey} -->" followed by "[GENERATE CONTENT HERE]".
Based on the section heading and surrounding context, generate appropriate narrative 
guidance content to replace "[GENERATE CONTENT HERE]".

The marker's position and the surrounding structural content tell you what kind of 
narrative guidance is needed. Infer the purpose from context - do not ask for clarification.

Output only the narrative content (no markers, no preamble, no meta-commentary).`;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Generating narrative for: ${narrativeKey}`);
  console.log(`${'='.repeat(80)}\n`);

  const model = setupModel({ 
    modelName: 'claude-sonnet-4-20250514',
    maxTokens: 4000 
  });

  const response = await model.invoke(prompt, {
    runName: `generate-narrative-${narrativeKey}`,
  });

  const content = response.content || '';
  
  console.log(`Generated ${content.split(' ').length} words`);

  return {
    key: narrativeKey,
    content,
  };
}

describe('Narrative Generation from Skeleton', () => {
  it('should generate coherent narratives from skeleton spec', async () => {
    console.log('Testing Narrative Generation from Skeleton\n');

    // Load skeleton spec
    const skeletonPath = path.join(
      __dirname,
      '../tests/games/specs/westward-peril-skeleton.md'
    );
    const skeletonSpec = await fs.readFile(skeletonPath, 'utf-8');

    console.log(`Loaded skeleton: ${skeletonSpec.split(' ').length} words`);
    console.log(`Estimated tokens: ~${Math.round(skeletonSpec.length / 4)}\n`);

    const results: GenerationResult[] = [];

    // Test 1: Generate TONE_STYLE (no dependencies)
    const toneStyle = await generateNarrative(skeletonSpec, 'TONE_STYLE');
    results.push(toneStyle);

    // Test 2: Generate TURN_1_GUIDE (can reference tone)
    const turn1Guide = await generateNarrative(skeletonSpec, 'TURN_1_GUIDE', results);
    results.push(turn1Guide);

    // Test 3: Generate TURN_2_GUIDE (can reference both previous)
    const turn2Guide = await generateNarrative(skeletonSpec, 'TURN_2_GUIDE', results);
    results.push(turn2Guide);

    // Save results
    const outputPath = path.join(__dirname, '../test-results/narrative-generation-test.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

    // Save as readable markdown
    const markdownPath = path.join(__dirname, '../test-results/narrative-generation-test.md');
    const markdown = `# Narrative Generation Test Results

## Summary

- **Skeleton Size**: ${skeletonSpec.split(' ').length} words
- **Narratives Generated**: ${results.length}

${results.map(r => `
## ${r.key}

**Word Count**: ${r.content.split(' ').length}

${r.content}
`).join('\n---\n')}

## Coherence Analysis

### Questions to Validate:

1. **Tone Consistency**: Does TURN_1_GUIDE respect the tone established in TONE_STYLE?
2. **Progressive Detail**: Does TURN_2_GUIDE build on TURN_1_GUIDE without contradicting it?
3. **Thematic Alignment**: Do all narratives maintain western frontier survival theme?
4. **Structural Respect**: Do narratives reference and respect skeleton requirements?
5. **Cross-References**: Do later narratives appropriately reference earlier ones?

### Manual Review Required:

- Read TONE_STYLE, then read TURN_1_GUIDE - does tone match?
- Compare TURN_1_GUIDE and TURN_2_GUIDE - are they complementary or contradictory?
- Check if any narrative contradicts structural requirements in skeleton
`;

    await fs.writeFile(markdownPath, markdown);

    console.log(`\n${'='.repeat(80)}`);
    console.log('Test Complete');
    console.log(`${'='.repeat(80)}`);
    console.log(`\nResults saved to:`);
    console.log(`  JSON: ${outputPath}`);
    console.log(`  Markdown: ${markdownPath}`);
    console.log(`\nNext step: Review ${markdownPath} to validate coherence`);

    // Assertions
    expect(results).toHaveLength(3);
    expect(results[0].key).toBe('TONE_STYLE');
    expect(results[1].key).toBe('TURN_1_GUIDE');
    expect(results[2].key).toBe('TURN_2_GUIDE');
    expect(results[0].content.length).toBeGreaterThan(100);
    expect(results[1].content.length).toBeGreaterThan(100);
    expect(results[2].content.length).toBeGreaterThan(100);
  }, 120000); // 2 minute timeout for LLM calls
});
