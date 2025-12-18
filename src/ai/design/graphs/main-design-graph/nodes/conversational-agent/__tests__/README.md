# Testing the Conversational Design Agent

## Quick Start

Run the manual test suite:

```bash
npm run test:conversational-agent
```

This will execute 6 different test scenarios and show you the agent's responses and flag settings.

## Test Scenarios

The manual test suite covers:

1. **Initial Game Idea** - First conversation, no updates expected
2. **Defining Game Rules** - Should set `spec_update_needed = true`
3. **Describing Game Components** - Should set `metadata_update_needed = true`  
4. **Rules + Components Together** - Should set both flags to `true`
5. **Explicit Spec Request** - User asks for full spec generation
6. **Clarification Question** - Should ask questions without setting flags

## What the Tests Check

Each test verifies:
- ✅ **Response Quality** - Agent provides helpful, conversational responses
- ✅ **Game Title** - Extracts and returns game title
- ✅ **Spec Flag** - Correctly identifies when specification needs updating
- ✅ **Metadata Flag** - Correctly identifies when gamepiece metadata needs extracting
- ✅ **Tag Stripping** - Internal tags are removed from user-facing messages

## Test Output Example

```
==========================================================
TEST: Defining Game Rules
==========================================================

📨 INPUT:
  USER: I want a card game
  ASSISTANT: Great! Tell me more about the gameplay.
  USER: Players start with 5 cards, draw 1 per turn...

🤖 RESPONSE:
Perfect! I'll update the game specification with those rules...

📊 FLAGS:
  Game Title: Card Battle
  Spec Update Needed: true ✅
  Metadata Update Needed: false ✅
```

## Running Individual Functions

You can also test individual helper functions:

```typescript
import { extractGameTitle, hasTag, stripInternalTags } from '../index.js';

// Test tag extraction
const response = "Great idea!\n\n<game_title>Epic Quest</game_title>\n<spec_update_needed>";
const title = extractGameTitle(response);  // "Epic Quest"
const needsSpec = hasTag(response, "<spec_update_needed>");  // true
const cleaned = stripInternalTags(response);  // "Great idea!" (tags removed)
```

## Unit Tests (Jest)

Full Jest test suite is available in `conversational-agent.test.ts`:

```bash
# Run Jest tests (when configured)
npm run build && npx jest conversational-agent.test.ts
```

The Jest suite includes:
- **Tag Parsing Tests** - Verify tag extraction logic
- **Prompt Formatting Tests** - Verify few-shot example formatting
- **Integration Tests** - Test actual agent behavior with LLM
- **Edge Case Tests** - Empty messages, constraints, etc.

## Environment Setup

Ensure you have environment variables configured:

```bash
# In your .env file
CHAINCRAFT_DESIGN_MODEL_NAME=anthropic/claude-3-5-sonnet-20241022
CHAINCRAFT_DESIGN_TRACER_PROJECT=chaincraft-design

# Optional: LangSmith tracing
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_key_here
```

## What to Look For

### ✅ Good Signs:
- Agent asks clarifying questions when needed
- Flags are set appropriately based on input
- Game titles are creative and relevant
- Responses are conversational, not robotic
- Tags are properly stripped from user-facing messages

### ⚠️ Warning Signs:
- Agent sets flags when it shouldn't (false positives)
- Agent misses obvious rule/component descriptions (false negatives)
- Responses include internal tags like `<spec_update_needed>`
- Agent generates specs directly instead of routing to spec agent
- Title is missing or generic

## Debugging Tips

### Enable Verbose Output

Add console logging to see what's happening:

```typescript
// In index.ts, before calling model
console.log("System Prompt:", systemPrompt.substring(0, 200));
console.log("Message Count:", messages.length);
console.log("Last Message:", messages[messages.length - 1].content);

// After getting response
console.log("Raw Response:", responseText);
console.log("Extracted Title:", gameTitle);
console.log("Flags:", { specUpdateNeeded, metadataUpdateNeeded });
```

### Check LangSmith Traces

If tracing is enabled, check LangSmith for:
- Token usage
- Latency
- Actual prompts sent to model
- Model responses

### Test with Different Models

Try different models to compare behavior:

```bash
# In .env
CHAINCRAFT_DESIGN_MODEL_NAME=anthropic/claude-3-5-sonnet-20241022
# or
CHAINCRAFT_DESIGN_MODEL_NAME=openai/gpt-4-turbo
```

## Common Issues

### "Cannot find module" errors
Run `npm run build` first to compile TypeScript.

### Model timeout errors  
Increase timeout in test or check network connection.

### Unexpected flag values
Check that few-shot examples in `prompts.ts` clearly demonstrate expected behavior.

### Missing tags in response
Verify system prompt includes clear instructions about when to use tags.

## Iterating on Prompts

If tests reveal issues:

1. **Update `prompts.ts`**:
   - Adjust `SYSTEM_PROMPT` for clearer instructions
   - Add/modify `FEW_SHOT_EXAMPLES` to demonstrate correct behavior
   - Update trigger criteria in "WHEN TO TRIGGER OTHER AGENTS" section

2. **Re-run tests** to verify improvements

3. **Check with real conversations** to ensure changes work in practice

### Next: Other Node Tests

Once the conversation node works, we can test other nodes:

1. Test `spec-plan` node
2. Test `spec-execute` node

## Need Help?

Check:
- `TAG_MECHANISM.md` - How tags work
- `FEW_SHOT_USAGE.md` - How examples are used
- `PROMPT_IMPROVEMENTS.md` - Design decisions and rationale
