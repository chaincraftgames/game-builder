# Game End and Winner Determination — Patterns and Coverage

Design artifact and authoring guidance. The engine splits "the game is over" from
"who won" into two independent declarations; every scenario below is expressed as a
combination of the two.

| Concern | Where it lives | When it runs | Bound roots |
|---|---|---|---|
| **Ending** | `endCondition` / `count` on a `loop` | `checkAfter: iteration` (default) → after every child runs; `checkAfter: turn` → after each player's turn | `iteration`: none (use `all()` / `any()` / `countPlayers()`); `turn`: `actor` = the player who just acted |
| **Winning** | `winConditions[]` on the `game` root | Once, when the root completes (after its `onComplete` hooks) | `player` = each player being evaluated (rules are checked once per player) |

Consequences:
- A win condition never sees "the current actor" — there is no turn in progress.
- An `endCondition` never decides a winner — it only stops the loop.
- Both are required. An `endCondition` without `winConditions` ends the game with
  outcome `flow-exhausted` and no winners.

## Player elimination

Every player has a built-in `player.property.eliminated` (boolean, default `false`).
Setting it `true` (via `set-state`) removes the player from turn eligibility in every
turn-ordering kind. It does **nothing else**: eliminated players remain visible to
expressions, `matching` targets, messages, and win conditions. Filter explicitly with
`not player.property.eliminated` where that matters.

## Ending the game

| # | Trigger | Status | Pattern |
|---|---|---|---|
| 1 | N rounds completed | ✅ | `count: N` |
| 2a | All but one player eliminated | ✅ | `endCondition: "countPlayers(not player.property.eliminated) <= 1"` |
| 2b | All players holding a role eliminated | ❌ | Roles are not readable in expressions. Roadmap R6. |
| 3a | A game inventory empties | ✅ | `endCondition: "count(game.inventory.deck) == 0"` |
| 3b | A player's inventory empties | ✅ | `checkAfter: turn` + `"count(actor.inventory.hand) == 0"`, or `"any(count(player.inventory.hand) == 0)"` |
| 4a | Score total reached | ✅ | `checkAfter: turn` + `"actor.property.score >= 10"` (add `finalRound: true` for "everyone else gets one more turn") |
| 4b | Score-track position reached | ⚠️ | Model the track as a number property; the physical track is presentation. No "position of piece in line" query exists. |
| 5a | A specific non-player piece is killed | ⚠️ | ✅ when death moves the piece to an inventory and *any* death suffices (`count(game.inventory.graveyard) >= 1`). ❌ for "*this* piece" or "its `hp <= 0`" — pieces cannot be addressed by ID. Roadmap R4. |
| 5b | Occupy N spaces / specific spaces | ⚠️ | ✅ when territory is a player inventory (`count(player.inventory.territory) >= 5`). ❌ on a shared grid: `count()` has no filter. Roadmap R5. |
| 5c | Move a piece into a specific space | ⚠️ | ✅ into an inventory (`count(player.inventory.escaped) >= 1`). ❌ into a specific cell, or for a specific piece. Roadmap R4. |
| 5d | Acquire specific pieces / counts | ⚠️ | ✅ counts via `count()` or a computed property with `ofType`. ❌ specific pieces. Roadmap R4. |

## Deciding the winner

| Trigger | Status | Pattern |
|---|---|---|
| Player who triggered the end | ❌ | Nothing records the triggering player, and there is no `player.id` path. Roadmap R1 + R2. |
| Highest score after a final round | ✅ | `finalRound: true` on the loop + `rule: ranking` |
| Highest / lowest stored property | ✅ | `rule: ranking`, `order: highest\|lowest` |
| Highest computed property or inventory count | ❌ | `ranking` reads stored properties only. Roadmap R3. |
| Chained tiebreak (score, then coins) | ❌ | `tiebreak` is only `all-win` / `no-winner`. Roadmap R3. |
| Last player standing | ✅ | `rule: condition`, `condition: "not player.property.eliminated"` |
| Per-player objective | ✅ | `rule: condition` |
| Team / role wins | ❌ | `role-condition` is in the schema; the assembler throws. Roadmap R6. |
| Co-op: everyone wins | ✅ | `condition: "game.property.escaped == true"` is true for every player |
| Co-op: everyone loses | ⚠️ | Works (zero winners) but outcome reason is `flow-exhausted`. Roadmap R7. |
| Placement (2nd, 3rd…) | ❌ | Needs elimination order. Deferred. |

## Idioms

**Last player standing** — pair the two declarations:
```yaml
children:
  - kind: loop
    endCondition: "countPlayers(not player.property.eliminated) <= 1"
winConditions:
  - rule: condition
    condition: "not player.property.eliminated"
```

**First to N points, everyone else gets one more turn, highest wins:**
```yaml
children:
  - kind: loop
    checkAfter: turn
    finalRound: true
    endCondition: "actor.property.score >= 10"
winConditions:
  - rule: ranking
    property: player.property.score
```

**Eliminate a player declaratively** (no `custom` effect):
```yaml
- id: checkElimination
  effect: set-state
  path: player.property.eliminated
  value: true
  target:
    kind: matching
    condition: "count(player.inventory.playerCup) == 0"
```

## Roadmap (tracked in compiler-roadmap; all generic)

| Id | Item | Unblocks |
|---|---|---|
| R1 | `player.id` / `actor.id` expression paths | Comparing players; R2 |
| R2 | Reserved `game.property.endTrigger`, written by the runtime when a `checkAfter: turn` exit or `finalRound` trigger fires | "Triggering player wins" |
| R3 | `ranking.property` → any expression; `tiebreakBy: [expr]`; decide eliminated-player handling in `ranking` | Computed/inventory rankings, chained tiebreaks |
| R4 | `contains(inventoryPath, "pieceId")` + `gamepiece.<id>.property.X` root | Specific-piece objectives (5a, 5c, 5d) |
| R5 | `count(inventory, filter)` with `piece.*` bound per piece | Shared-board occupancy (5b), typed counts without computed props |
| R6 | Role predicates in expressions (`hasRole(...)`) + assemble `role-condition` | 2b, team wins |
| R7 | Distinct outcome reason for "win conditions ran, nobody won" | Co-op loss reporting |

### Elimination follow-ons
- `finalRound` trigger player eliminated during the final round → loop never exits (needs seat-position comparison instead of identity).
- Stall guard: a loop iteration in which no player can act and no state changes should raise a runtime error (feeds the repair loop).
- `distribute` to all players: decide whether eliminated players are skipped.
- `ranking` win rule: decide whether eliminated players are excluded by default (see R3).
