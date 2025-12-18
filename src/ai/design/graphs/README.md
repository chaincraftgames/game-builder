# Design Workflow Graphs

This directory contains the LangGraph implementation of the 3-agent design workflow:

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Design Graph                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────┐      ┌──────────────┐                       │
│  │ Conversational │─────>│  Plan Spec   │                       │
│  │     Agent      │      └──────────────┘                       │
│  └────────────────┘              │                               │
│         │                        ▼                               │
│         │              ┌──────────────┐                          │
│         │              │ Execute Spec │                          │
│         │              └──────────────┘                          │
│         │                        │                               │
│         │                        ▼                               │
│         │              ┌──────────────┐                          │
│         │              │  Diff Spec   │                          │
│         │              └──────────────┘                          │
│         │                        │                               │
│         │                        ├──────────┐                    │
│         ▼                        │          │                    │
│  ┌───────────────────────────────▼──┐       │                   │
│  │   Update Metadata (Subgraph)     │       │                   │
│  └───────────────────────────────┬──┘       │                   │
│                                  │          │                   │
│                                  ▼          ▼                   │
│                           ┌──────────────────┐                  │
│                           │ Present Updates  │                  │
│                           └──────────────────┘                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Gamepiece Metadata Extraction Subgraph              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐      ┌─────────────────┐                      │
│  │Plan Metadata │─────>│Execute Metadata │<──┐                  │
│  └──────────────┘      └─────────────────┘   │                  │
│                                 │             │                  │
│                                 ▼             │                  │
│                        ┌──────────────┐       │                  │
│                        │Validate      │       │                  │
│                        │Schema        │       │                  │
│                        └──────────────┘       │                  │
│                                 │             │                  │
│                        ┌────────┴──────────┐  │                  │
│                        │    Valid?         │  │                  │
│                        └────────┬──────────┘  │                  │
│                          No     │     Yes     │                  │
│                    ┌────────────┴──────┐      │                  │
│                    │                   │      │                  │
│                    ▼                   ▼      │                  │
│          ┌──────────────┐     ┌──────────────┐│                  │
│          │Retry Execution│     │Validate      ││                  │
│          │(max 3 times) │     │Semantic      ││                  │
│          └──────────────┘     └──────────────┘│                  │
│                    │                   │      │                  │
│                    └───────────────────┘      │                  │
│                    │                          │                  │
│                    │ Max retries              │                  │
│                    ▼                          ▼                  │
│          ┌──────────────┐            ┌──────────────┐            │
│          │ Escalate to  │            │Diff Metadata │            │
│          │    Human     │            └──────────────┘            │
│          └──────────────┘                                        │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
graphs/
├── main-design-graph/
│   ├── index.ts                    # Graph compilation & routing logic
│   └── nodes/
│       ├── conversational-agent/
│       │   ├── index.ts         # Main agent logic
│       │   ├── prompts.ts       # System prompts
│       │   └── __tests__/
│       ├── spec-plan/
│       │   ├── index.ts         # Plan generation
│       │   └── prompts.ts
│       ├── spec-execute/
│       │   ├── index.ts         # Spec generation
│       │   └── prompts.ts
│
└── gamepiece-metadata-subgraph/
    ├── index.ts                    # Subgraph compilation & routing
    └── nodes/
        ├── plan-metadata/
        │   ├── index.ts           # Metadata planning
        │   └── prompts.ts         # Planning prompts
        ├── execute-metadata/
        │   ├── index.ts           # Metadata extraction
        │   └── prompts.ts         # Extraction prompts
        ├── validate-schema/
        │   └── index.ts           # JSON Schema validation (Ajv)
        ├── validate-semantic/
        │   ├── index.ts           # Business rules validation
        │   ├── validators.ts      # Validation functions
        │   └── types.ts           # Type definitions
        ├── retry-execution/
        │   └── index.ts           # Retry preparation
        ├── escalate-to-human/
        │   └── index.ts           # Human intervention
        └── diff-metadata/
            └── index.ts           # Metadata diff generation
```

## Key Concepts

### Natural Language Plans
Instead of structured JSON operation schemas, we use natural language change plans:
- **Planning agent** describes changes in prose
- **Execution agent** interprets plan and generates content
- Reduces failure points and improves clarity

### State-Based Routing
Routing is handled via flags in the state (not separate route nodes):
- `spec_update_needed`: Route to spec update flow
- `metadata_update_needed`: Route to metadata subgraph
- Routing functions are inline in the graph definition

### Validation Strategy
Metadata validation has two layers:
1. **Schema Validation**: JSON Schema + Ajv (structural correctness)
2. **Semantic Validation**: Business rules (logical consistency)

Failed validations trigger retry with max 3 attempts, then escalate to human.

### Backward Compatibility
The `GameDesignState` has been extended with new fields but remains backward compatible with existing code:
- Old fields preserved: `currentGameSpec`, `specRequested`, etc.
- New fields added: `spec_update_needed`, `metadata`, `validation_errors`, etc.

## Implementation Status

**✅ Completed:**
- Directory structure created
- Stub files with TODOs and documentation
- State schema extended (backward compatible)
- JSON Schema for metadata validation
- Few-shot examples for metadata extraction
- Routing logic defined

**⏳ Pending:**
- Implement individual node functions
- Wire nodes into compiled graphs
- Add LLM calls with structured output
- Implement validation logic
- Testing and integration

## Next Steps

1. **Start with conversational agent**: Implement the entry point
2. **Spec flow**: Implement plan → execute → diff
3. **Metadata flow**: Implement planning and extraction
4. **Validation**: Add schema and semantic validators
5. **Integration**: Wire everything together and test

## Related Files

- `game-design-state.ts`: Extended state schema
- `schemas/gamepiece-metadata.schema.json`: JSON Schema for validation
- `schemas/gamepiece-metadata.examples.json`: Few-shot examples
- `design-workflow.ts`: Public interface (to be updated)
