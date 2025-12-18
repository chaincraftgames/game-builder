# Few-Shot Examples Usage Guide

## Why Separate System Prompt from Few-Shot Examples?

**System Prompt** = Instructions (what to do)
**Few-Shot Examples** = Demonstrations (how to do it)

Keeping them separate provides:
1. **Cleaner prompts** - Instructions aren't cluttered with examples
2. **Better model performance** - LLMs learn better from actual conversation patterns
3. **Easier maintenance** - Can update examples independently from instructions
4. **Reusability** - Same examples can be used with different system prompts

## How Few-Shot Examples Work

Few-shot examples are injected as **actual conversation messages** in the prompt, positioned between the system message and the real user conversation:

```
[System Message] ← Instructions and rules
[Human Message] ← Few-shot example 1 (user)
[AI Message]    ← Few-shot example 1 (assistant)
[Human Message] ← Few-shot example 2 (user)
[AI Message]    ← Few-shot example 2 (assistant)
...
[Human Message] ← Real user message 1
[AI Message]    ← Real assistant response 1
[Human Message] ← Real user message 2 (current)
```

This teaches the model the expected behavior pattern through demonstration, not just instruction.

## Implementation Pattern

### In `prompts.ts`:

```typescript
export const SYSTEM_PROMPT = `Instructions go here...`;

export const FEW_SHOT_EXAMPLES = [
  {
    user: "User message",
    assistant: "Assistant response with <game_title>Title</game_title>",
    flags: { spec_update_needed: true, metadata_update_needed: false },
    explanation: "Why these flags were set (for developers)"
  },
  // ... more examples
];
```

### In `index.ts` (node implementation):

```typescript
import { SYSTEM_PROMPT, FEW_SHOT_EXAMPLES } from "./prompts.js";

const messages = [
  new SystemMessage(systemPrompt),
  
  // Inject few-shot examples as conversation history
  ...FEW_SHOT_EXAMPLES.flatMap(example => [
    new HumanMessage(example.user),
    new AIMessage(example.assistant)
  ]),
  
  // Add real user conversation
  ...state.messages
];

const response = await llm.invoke(messages);
```

## What the `flags` Field Does

The `flags` field in each example is **metadata for developers**, not sent to the LLM. It serves two purposes:

1. **Documentation**: Shows what flags SHOULD be set for each scenario
2. **Testing**: Can be used to validate the model's output matches expected behavior

Example test:
```typescript
test('conversational agent sets correct flags', async () => {
  for (const example of FEW_SHOT_EXAMPLES) {
    const result = await agent({ messages: [new HumanMessage(example.user)] });
    expect(result.spec_update_needed).toBe(example.flags.spec_update_needed);
    expect(result.metadata_update_needed).toBe(example.flags.metadata_update_needed);
  }
});
```

## Current Examples Coverage

Our 6 examples cover key scenarios:

| # | Scenario | Flags | Purpose |
|---|----------|-------|---------|
| 1 | Initial conversation | None | Discovery/clarification |
| 2 | Rules defined | Spec only | Game mechanics update |
| 3 | Components described | Metadata only | Gamepiece extraction |
| 4 | Rules + components | Both | Combined update |
| 5 | Big design change | None | Seek clarification first |
| 6 | Explicit request | Spec only | Direct spec generation |

## When to Add More Examples

Add examples when you observe:
- Model consistently misses a flag it should set
- Model sets flags when it shouldn't
- New scenario types emerge that aren't covered
- Edge cases cause confusion

**Keep examples focused**: Each should demonstrate one clear behavior pattern.

## Template Variables in System Prompt

The system prompt uses template variables that get filled at runtime:

```typescript
const systemPrompt = SYSTEM_PROMPT
  .replace('{mechanics_registry}', mechanicsRegistry)
  .replace('{constraints_registry}', constraintsRegistry);
```

These let you inject context-specific information without hardcoding it in the prompt file.

## Best Practices

### ✅ DO:
- Keep examples concise but realistic
- Show diverse scenarios (no flags, one flag, both flags)
- Include `<game_title>` tags in all assistant responses
- Use natural, conversational language
- Add `explanation` field to document the learning point

### ❌ DON'T:
- Duplicate instructions from system prompt in examples
- Make examples too long or complex
- Include technical implementation details in examples
- Use examples to give instructions (that's the system prompt's job)
- Send the `flags` or `explanation` fields to the LLM

## Evolution Strategy

As the system is used:

1. **Monitor conversations** where flags are incorrect
2. **Identify patterns** in the mistakes
3. **Add examples** that demonstrate the correct behavior
4. **Remove examples** that are no longer needed or redundant
5. **Iterate** based on real usage data

Few-shot examples should evolve with your system to maintain high performance.
