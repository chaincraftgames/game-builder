# @chaincraft/gamedef

Modular game specification for ChainCraft — Zod schemas, TypeScript types, and a
validator library. This is the contract between all ChainCraft systems that produce
or consume game specs.

## Overview

A `ModularGameSpec` is a structured description of a game that ChainCraft AI agents
generate and the ChainCraft engine executes. It is intentionally platform-independent:
the spec describes *what* a game is, not how any specific engine implements it.

The spec is **modular** — include only the sections your game needs. Each module is
independently schema-validated, and the validator library checks cross-module
references. All modules are optional at the top level; the engine treats absent
modules as empty.

## Package exports

```ts
// Schemas, types, and top-level spec
import { ModularGameSpecSchema, type ModularGameSpec } from "@chaincraft/gamedef";

// Individual module schemas
import { FlowModuleSchema, ActionsModuleSchema } from "@chaincraft/gamedef";

// Mechanic schemas
import { ScoreTrackMechanicSchema, ChargesMechanicSchema } from "@chaincraft/gamedef";

// Validator
import { validate } from "@chaincraft/gamedef/validator";
```

## Spec modules

| Module | Purpose |
|--------|---------|
| `metadata` | Game title, player count, RNG configuration |
| `players` | Role definitions, assignment rules, player-scoped properties |
| `gamepieceTypes` | Piece type definitions — properties, inventory slots, action slots, mechanics |
| `inventories` | Inventory type declarations — structure, scope, capacity, visibility |
| `effects` | Named reusable effects referenced by actions and flow hooks |
| `actions` | Player-facing actions — inputs, preconditions, effect sequences |
| `flow` | Game structural skeleton — loop/turn/simultaneous nodes, hooks, interrupts |
| `catalog` | Piece registry — declares piece instances and initial property values |
| `mechanics` | Game-level mechanic declarations (score tracks, dominant-gamepiece evaluation, etc.) |

### System inventories

`game:unassigned` is a reserved system inventory automatically created by the engine.
All catalog pieces start here. Setup effects in the root flow loop's `onEnter` hooks
move pieces into their starting inventories before the first turn begins.

## Built-in mechanics

Mechanics are first-class abstractions that synthesize inventories, action slots,
preconditions, and flow wiring from a compact declaration. The engine knows what
each mechanic `kind` injects; spec authors only provide configuration values.

**Piece-level** (declared in `gamepieceTypes[].mechanics[]`):

| Kind | Purpose |
|------|---------|
| `chaincraft:charges` | Gates an action behind a charge cost (energy counters, exhaustion, etc.) |
| `chaincraft:conversion` | Spend N resources to produce M resources |

**Game-level** (declared in `mechanics[]`):

| Kind | Purpose |
|------|---------|
| `chaincraft:score-track` | Player/team score tracking on a line inventory |
| `chaincraft:dominant-gamepiece` | Who-beats-whom resolution: dominant-gamepiece suits, highest-wins, and Rock-Paper-Scissors |

See `src/mechanics/WISHLIST.md` for mechanics in design.

## Validator

The validator runs schema validation first, then a list of modular `SpecValidator` passes:

1. **Schema validation** — Zod parse of each module (always first)
2. **ResolveRefs** — cross-module forward reference resolution
3. **DuplicateIds** — uniqueness of IDs within each module and the flow tree
4. **FlowIntegrity** — loop termination and flow structural rules

To add a new validator: implement `SpecValidator` in `src/validator/validators/` and append an instance to the `VALIDATORS` list in `src/validator/index.ts`.

```ts
import { validate } from "@chaincraft/gamedef/validator";

const result = validate(rawSpec); // rawSpec: unknown (JSON/YAML parse output)
if (!result.valid) {
  for (const error of result.errors) {
    console.error(`${error.path}: ${error.message}`);
  }
} else {
  const spec = result.spec; // typed as ModularGameSpec
}
```

## Usage as a local dependency

This package does not need to be published to npm. Add it as a file dependency:

```json
"dependencies": {
  "@chaincraft/gamedef": "file:../gamedef"
}
```

Then import using the package name — Node.js subpath imports (`#gamedef/*`) resolve
to `src/` at development time and `dist/` after `npm run build`.

## Development

```bash
npm install
npm run build      # tsc → dist/
npm test           # run all schema + validator tests
npm run test:spec  # schema tests only
npm run test:validator  # validator tests only
```

## Structure

```
src/
  index.ts              # top-level barrel — ModularGameSpecSchema + all re-exports
  modules/              # one file per spec module
    common.ts           # shared primitives (JsonLogic, StatePath, IntRange)
    metadata.ts
    players.ts
    gamepiece-types.ts
    inventories.ts
    effects.ts
    actions.ts
    flow.ts
    catalog.ts
  mechanics/            # one file per built-in mechanic
    index.ts            # barrel — PieceMechanicSchema, GameMechanicSchema
    charges.ts
    conversion.ts
    score-track.ts
    dominant-gamepiece.ts
    WISHLIST.md         # mechanics in design / on the roadmap
  validator/
    index.ts            # validate(raw) → ValidationResult; VALIDATORS list
    types.ts            # SpecValidator interface, ValidationError, ValidationResult
    validators/         # one file per validator — implement SpecValidator, register in index.ts
      resolve-refs.ts   # Pass 2: cross-module forward reference resolution
      duplicate-ids.ts  # Pass 3: duplicate ID detection (modules + flow tree)
      flow-integrity.ts # Pass 4: loop termination and flow structural rules
tests/
  spec/                 # schema tests (one file per module)
  validator/            # validator integration tests
```

### Components 
These are passive attributes that define the state and properties of an entity. They affect gameplay broadly and are always "active" as long as they are attached to an entity. They may not have a direct graphical representation, but they define the underlying data and rules of the game.  Components may be standard components of may be introduced as part of a mechanic.

Components are defined in the `components.yaml` file in the `registries` directory. Each component has a corresponding JSON schema file in the `schemas` directory.  


### Actions
These are active behaviors that require input or decision from the user (or AI for non-player entities). They have a direct impact on the game state and often have a graphical representation (like an animation). They can be enabled or disabled, providing a dynamic aspect to the gameplay.  Actions may be standard actions or may be introduced as part of a mechanic.

Actions are defined in the `actions.yaml` file in the `registries` directory. Each action has a corresponding JSON schema file in the `schemas` directory.


## Actions


## Contributing
Contributions are welcome! Please read the contributing guidelines before making any changes.
