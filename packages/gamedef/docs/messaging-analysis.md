# Messaging and LLM Calls in the Modular Spec

**Status:** Analysis only — no schema changes yet.  
**Context:** Absurd Armaments is the reference example.

---

## 1. The Problem

The current modular spec has no way to describe:
1. **Player messaging** — when to send a message to a player and what it contains
2. **LLM calls** — when to invoke an LLM, what to ask it, and where to use the result

Both concepts exist implicitly in the current game-builder runtime (via `messages` blocks and
`mechanicsGuidance` in transition and action instructions), but they are not represented in the
declarative spec.

---

## 2. What Absurd Armaments Actually Does

The artifact has **5 transitions** and **2 player actions** that collectively show three
distinct messaging/LLM patterns:

### Pattern A — Pure state update, no LLM, no messaging
- `weapons_selected`: just advances the phase, nothing to narrate.
- `create-weapon` state delta: pure append.

### Pattern B — Deterministic message (no LLM)
- `create-weapon` (player action): private confirmation message sent to the acting player.
  The content is a template string — no LLM involved.

### Pattern C — LLM narrates → public broadcast
- `initialize_game`: LLM generates `openingAnnouncement` → broadcast to all.
- `match_continues`: LLM computes RPS winner + generates `roundNarrative` → broadcast to all.
- `match_won`: same as `match_continues`, ends the game.

### Pattern D — LLM narrates → per-player private messages
- `reveal_complete`: LLM generates `player1Reveal` and `player2Reveal` separately →
  each player gets their own private message about their **opponent's** weapons.

### Pattern E — LLM computes AND narrates in one call
- `match_continues` / `match_won`: `mechanicsGuidance.computation` asks the LLM to:
  1. Apply RPS logic to determine the round winner
  2. Optionally weave in a dramatic reversal (flagged by RNG, but LLM writes it)
  3. Generate the battle narrative
  
  These are **entangled** — the narrative must reflect the outcome. A single LLM call does both.
  The RPS outcome (a state write) and the narrative (a message) come from the same LLM response.

---

## 3. The Key Design Question

> Should messaging and LLM calls be **effects**?

**Yes, with caveats:**

Effects in the spec are atomic state transitions. Messaging is output-only (no state
change), but it fits the "do something at this point in the game" semantic. And LLM calls
produce values — either stored state (computation) or messages (narration) — which is
exactly what effects do.

The main tension: LLM calls in Absurd Armaments are **dual-purpose** (compute + narrate
simultaneously). Forcing a split into two separate effects would either:
- Require two LLM API calls (expensive and creates consistency risk)
- Require a shared "ephemeral context" mechanism not currently in the spec

---

## 4. Proposed Effect Kinds

### 4.1 `kind: message` — Deterministic message delivery

Used for Pattern B: send a pre-known message to one or more players. No LLM involved.

```yaml
id: confirm-weapon
kind: message
to: actor         # actor | all | opponents | role:<roleId>
template: "Your weapon '{{input.weaponDescription}}' has been registered."
visibility: private  # private | public
```

**Fields:**
| Field | Required | Notes |
|-------|----------|-------|
| `to` | yes | `actor`, `all`, `opponents`, `role:<id>`, `player-id` |
| `template` | yes | Handlebars string; `{{input.*}}` and `{{state.*}}` refs |
| `visibility` | no | `public` (default) or `private` |

For non-text games: engines that don't support messaging skip this effect kind.
No state mutation occurs.

---

### 4.2 `kind: llm-effect` — LLM computation and/or narration

Used for Patterns C, D, E: call an LLM, capture named outputs, optionally deliver
them as messages.

```yaml
id: generate-opening
kind: llm-effect
prompt:
  rules:
    - "Use enthusiastic game-show announcer style"
    - "Welcome both players by name"
    - "Include a groan-worthy pun"
  computation: >
    Generate a boisterous opening announcement that welcomes both players,
    sets the tone for absurd weapon combat, and builds excitement.
outputs:
  - field: openingAnnouncement
    message:
      to: all
      visibility: public
```

**Fields:**
| Field | Required | Notes |
|-------|----------|-------|
| `prompt.rules` | no | Ordered style/tone constraints for the LLM |
| `prompt.computation` | yes | What the LLM should produce or decide |
| `outputs[]` | yes | One entry per named output the LLM produces |
| `outputs[i].field` | yes | Name of the output; stored in transient context for this action |
| `outputs[i].message` | no | If present, deliver this field as a player message |
| `outputs[i].message.to` | yes when present | Same options as `kind: message` |
| `outputs[i].message.visibility` | no | `public` (default) or `private` |
| `outputs[i].stateWrite` | no | If present, write this field to a state path (dot-path string) |

**Design note:** `field` values create an **ephemeral output context** scoped to this
effect invocation. Other effects in the same action can reference them via `{{llm.<field>}}`
(or a similar convention TBD). This allows a subsequent `kind: update` effect to store
the LLM-computed value in durable game state if needed.

---

## 5. Absurd Armaments Mapped to Proposed Effects

### `initialize_game` transition

```yaml
# In actions module, action id: initialize-game
effects:
  - id: setup-state
    kind: prose
    description: >
      Set currentPhase to weapon_creation, currentRound to 0, gameEnded to false.
      Initialize both players' weapons to empty array, roundsWon to 0,
      selectedWeapon to null, actionRequired to true.

  - id: generate-opening
    kind: llm-effect
    prompt:
      rules:
        - "Use enthusiastic game-show announcer style with obnoxious energy"
        - "Welcome both players by name"
        - "Include a groan-worthy pun that builds excitement"
      computation: >
        Create unique opening announcement that welcomes both players,
        incorporates groan-worthy puns when appropriate, and sets the
        tone for absurd weapon combat.
    outputs:
      - field: openingAnnouncement
        message:
          to: all
          visibility: public
```

### `reveal_complete` transition

```yaml
effects:
  - id: advance-to-round-1
    kind: prose
    description: >
      Set currentRound to 1, currentPhase to round_selection.
      Set both players' actionRequired to true.

  - id: generate-reveals
    kind: llm-effect
    prompt:
      rules:
        - "Generate separate reveal for each player about their opponent's weapons"
        - "Use game-show style with obnoxious sports commentator energy"
        - "Include groan-inducing puns naturally with weapon names"
        - "Each player receives a unique personalized reveal"
      computation: >
        Create a unique reveal announcement for each player showcasing
        their opponent's arsenal with dramatic flair and natural comedic commentary.
    outputs:
      - field: player1Reveal
        message:
          to: "player1"
          visibility: private
      - field: player2Reveal
        message:
          to: "player2"
          visibility: private
```

### `match_continues` transition

```yaml
effects:
  - id: rng-reversal
    kind: roll
    faces:
      - value: true
        weight: 0.25
      - value: false
        weight: 0.75
    writeTo: game.property.includeReversal

  - id: resolve-round
    kind: llm-effect
    prompt:
      rules:
        - "Rock beats scissors, scissors beats paper, paper beats rock"
        - "Ties result in no score change"
        - "Occasionally include wrestling-style dramatic reversal when includeReversal is true"
        - "Generate 2-4 sentence narrative with boisterous announcer style"
        - "Reference both weapons by name"
      computation: >
        Compare selected weapons using their RPS mappings. If includeReversal is true,
        build tension with a dramatic reversal before revealing the actual outcome.
        Determine winner and update scores. Generate round narrative.
    outputs:
      - field: roundWinner
        stateWrite: game.property.roundWinner   # engine uses this for score update
      - field: roundNarrative
        message:
          to: all
          visibility: public
```

**Note on the computation/state split:** In the current runtime this is one LLM call that
does both. In the spec, we expose this via `stateWrite` on an output field — the engine reads
the LLM's structured response for `roundWinner` and writes it to state. The round score
update then happens in a separate `kind: update` effect that reads `game.property.roundWinner`.

---

## 6. Non-Text Games

For games without text UI (board games with visual state display):
- `kind: message` effects are simply **skipped** by the engine.
- `kind: llm-effect` effects with no `stateWrite` on any output are also **skipped**.
- `kind: llm-effect` effects WITH `stateWrite` on some outputs are **partially executed**:
  the LLM is called for the computation, outputs with `stateWrite` are stored, but
  outputs with only `message` are not delivered.

This makes the spec **additive for text/narrative games** — the messaging effects are layered
on top of the base game logic, which works standalone.

---

## 7. Observations and Open Questions

### O1: LLM as "smart narrator" vs "decision maker"
In Absurd Armaments, the actual game outcome (who wins the round) is **deterministically**
computable from the state — no LLM needed. The LLM is asked to *narrate* it. But the spec
(via `prompt.computation`) still instructs the LLM to "determine winner and update scores".

This is an artifact of the current runtime where one LLM call does everything. In the modular
spec, it's cleaner to:
- Compute the winner deterministically in a `kind: update` or `kind: prose` effect
- Have the LLM narrate the outcome (reading from state, not deciding it)

This also makes testing easier: game logic is testable without LLM mocks.

### O2: `kind: llm-effect` vs `kind: prose` + `kind: message`
The simplest option would be to extend `kind: prose` to support messaging:
```yaml
kind: prose
description: "Compute winner and generate round narrative"
message:
  to: all
  template: "{{llm.roundNarrative}}"
```
But this conflates computation and messaging in a prose description, making both harder
to validate and generate code for. Keeping `kind: llm-effect` as a distinct kind makes
the LLM-calling semantic explicit.

### O3: Who delivers the message — the LLM or the template engine?
In `kind: message`, the template is resolved by the engine (deterministic). In
`kind: llm-effect`, the LLM generates the text and the engine delivers it. This is a
meaningful distinction for the engine's execution model.

### O4: Structured LLM output
For `outputs[i].stateWrite` to work, the LLM must return a structured response
(a JSON object with named fields). This implies an LLM output schema for the effect —
each `outputs[]` entry defines one field of that schema. The engine marshals the
structured response automatically.

### O5: `kind: message` in flow hooks
`onEnter`/`onComplete` in the flow DSL accept effect call lists. A `kind: message` there
would send a message when entering/leaving a flow node — e.g., "The bidding phase has begun."
This is a natural use case for phase announcements in text games.

---

## 8. Summary

| Concept | Proposed kind | When to use |
|---------|--------------|-------------|
| Static/template player message | `kind: message` | Deterministic confirmation, phase announcements |
| LLM narration → message | `kind: llm-effect` + `outputs[i].message` | Flavor text, reveal announcements |
| LLM computation → state | `kind: llm-effect` + `outputs[i].stateWrite` | Adjudication, complex NPC decisions |
| Both in one call | `kind: llm-effect` with both `message` and `stateWrite` outputs | Round resolution with narrative (Absurd Armaments) |
| Engine-computed narration | Not needed — use `kind: prose` for logic + `kind: message` for delivery | Deterministic outcomes with fixed templates |
