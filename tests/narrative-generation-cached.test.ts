/**
 * Test: Generate multiple narratives with caching strategy
 * 
 * This test validates the caching approach for narrative generation:
 * - Same skeleton + guidance (cacheable)
 * - Different marker keys (not cached)
 * - Generate all markers sequentially to validate coherence
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupNarrativeModel } from '#chaincraft/ai/model-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GenerationResult {
  key: string;
  content: string;
  wordCount: number;
}

/**
 * Extract all narrative markers from skeleton
 */
function extractMarkers(skeleton: string): string[] {
  const markerRegex = /<!-- NARRATIVE:(\w+) -->/g;
  const markers: string[] = [];
  let match;
  
  while ((match = markerRegex.exec(skeleton)) !== null) {
    markers.push(match[1]);
  }
  
  return markers;
}

/**
 * Generate narrative for a single marker using cache_control
 */
async function generateNarrative(
  skeleton: string,
  narrativeStyleGuidance: string,
  markerKey: string,
  previousNarratives: Map<string, string>
): Promise<GenerationResult> {
  
  console.log(`\nGenerating: ${markerKey}...`);

  const model = await setupNarrativeModel();

  // Keep skeleton constant in cached portion for cache reuse
  const response = await model.createInvocation!({ runName: `generate-narrative-${markerKey}` })
    .addCachedSystemPrompt(`You are filling in narrative guidance sections for a game specification.

${narrativeStyleGuidance}

SKELETON SPECIFICATION:
${skeleton}`)
    .addSystemPrompt(`

---

TASK:
Generate narrative content for the marker: <!-- NARRATIVE:${markerKey} -->

Based on the marker's location and surrounding context, write comprehensive narrative 
guidance that helps runtime LLMs generate appropriate game content.

Output only the narrative content (no markers, no commentary).`)
    .addUserPrompt("Begin.")
    .invoke();

  const content = response.content || '';
  const wordCount = content.split(/\s+/).length;
  
  // Log cache metrics
  const usage = (response as any).response_metadata?.usage;
  if (usage) {
    console.log(`  ✓ ${wordCount} words`);
    if (usage.cache_creation_input_tokens) {
      console.log(`    Cache created: ${usage.cache_creation_input_tokens} tokens`);
    }
    if (usage.cache_read_input_tokens) {
      console.log(`    Cache read: ${usage.cache_read_input_tokens} tokens (90% savings)`);
    }
    console.log(`    Input: ${usage.input_tokens || 0}, Output: ${usage.output_tokens || 0}`);
  } else {
    console.log(`  ✓ ${wordCount} words`);
  }

  return {
    key: markerKey,
    content,
    wordCount
  };
}

describe('Cached Narrative Generation', () => {
  it('should generate all narratives using caching strategy', async () => {
    console.log('\n=== Testing Cached Narrative Generation ===\n');

    // Load skeleton
    const skeletonPath = path.join(
      __dirname,
      'games/specs/westward-peril-skeleton.md'
    );
    const skeleton = await fs.readFile(skeletonPath, 'utf-8');

    // Define narrative style guidance (would come from plan node)
    const narrativeStyleGuidance = `GAME SUMMARY:
Westward Peril - A single-player survival game where players navigate 5 dangerous 
turns on a westward journey across the American frontier (1840s-1880s). Each turn 
presents 4 choices (1 deadly, 3 safe). Victory requires surviving all 5 turns.

GLOBAL NARRATIVE GUIDELINES:
- Setting: American frontier period (1840s-1880s)
- Tone: Dangerous, consequential, gritty and realistic
- Audience: Runtime LLMs that will generate scenarios, choices, and outcomes
- Purpose: Provide comprehensive guidance with examples of good/poor approaches
- Consistency: Maintain period authenticity and high-stakes atmosphere throughout`;

    // Extract all markers
    const markers = extractMarkers(skeleton);
    console.log(`Found ${markers.length} narrative markers:`);
    markers.forEach(m => console.log(`  - ${m}`));
    console.log('');

    // Generate all narratives sequentially
    const narratives = new Map<string, string>();
    const results: GenerationResult[] = [];

    const startTime = Date.now();

    for (const markerKey of markers) {
      const result = await generateNarrative(
        skeleton,
        narrativeStyleGuidance,
        markerKey,
        narratives
      );
      
      narratives.set(markerKey, result.content);
      results.push(result);
    }

    const totalTime = Date.now() - startTime;

    // Generate final spec with all narratives
    let finalSpec = skeleton;
    for (const [key, content] of narratives.entries()) {
      finalSpec = finalSpec.replace(
        `<!-- NARRATIVE:${key} -->`,
        content
      );
    }

    // Save results
    const outputPath = path.join(__dirname, '../test-results/narrative-generation-cached-test.md');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    const totalWords = results.reduce((sum, r) => sum + r.wordCount, 0);

    const markdown = `# Cached Narrative Generation Test Results

## Summary

**Skeleton**: ${skeleton.split(/\s+/).length} words (~${Math.round(skeleton.length / 4)} tokens)
**Style Guidance**: ${narrativeStyleGuidance.split(/\s+/).length} words (~${Math.round(narrativeStyleGuidance.length / 4)} tokens)
**Total Cacheable Content**: ~${Math.round((skeleton.length + narrativeStyleGuidance.length) / 4)} tokens

**Markers Generated**: ${markers.length}
**Total Narrative Words**: ${totalWords}
**Total Time**: ${(totalTime / 1000).toFixed(1)}s
**Average per Marker**: ${(totalTime / markers.length / 1000).toFixed(1)}s

## Caching Strategy

This test demonstrates the narrative generation caching pattern:

1. **Cached Content** (same for all calls):
   - Narrative style guidance
   - Skeleton specification
   - Previously generated narratives

2. **Uncached Content** (varies per call):
   - Marker key being generated (~5 tokens)

3. **Expected Savings with Cache Control**:
   - First call: Full input cost + cache write fee
   - Subsequent calls: 90% discount on cached portion
   - For ${markers.length} markers, estimated ~${Math.round(((markers.length - 1) / markers.length) * 90)}% total input token savings

## Generated Narratives

${results.map(r => `### ${r.key} (${r.wordCount} words)

${r.content}

---
`).join('\n')}

## Full Specification with Narratives

${finalSpec}
`;

    await fs.writeFile(outputPath, markdown, 'utf-8');
    console.log(`\n✓ Results saved to: ${outputPath}`);
    console.log(`\nTotal: ${totalWords} narrative words across ${markers.length} markers`);
    console.log(`Time: ${(totalTime / 1000).toFixed(1)}s (avg ${(totalTime / markers.length / 1000).toFixed(1)}s per marker)\n`);

    // Verify we generated content for all markers
    expect(results.length).toBe(markers.length);
    results.forEach(r => {
      expect(r.wordCount).toBeGreaterThan(50); // Each narrative should be substantial
    });

  }, 600000); // 10 minute timeout for generating all narratives
});
