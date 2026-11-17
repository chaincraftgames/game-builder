# Known gaps

Things the schema or a brief suggests you can do, but the engine does not support. Each entry
says what happens instead and what to do.

## Message templates have no winner or actor token

A `message` template substitutes only `{{input.<id>}}`, `{{state.game.property.<id>}}` and
`{{state.players.<playerId>.property.<id>}}`. There is no token for "the winner" or "the acting
player", and `<playerId>` is a runtime id a spec cannot know. `validate` rejects any other token.

**Do:** don't announce winners in the spec. Game clients display the winners and the outcome, so
a win message is not needed. If a brief asks for one, leave it out and record the decision in
`brief.md` under Decisions.

## Message templates do not read computed properties

`{{state.game.property.<id>}}` and `{{state.players.<playerId>.property.<id>}}` read stored
values only. For a computed property (one with `computed:`) the token is not replaced and appears
as written in the message. `validate` cannot tell, because the property exists.

**Do:** write the value into a stored property with `set-state` (a `{ expr: ... }` value can read
the computed one) and put that property in the template.

## Effects cannot be conditional

An effect call has no condition: every `effectRef` or inline effect in a list always runs. There is
no `when:` guard and no `if` effect, so "gain a coin only if the roll was a 6" or "announce a
critical hit only when the roll was a 6" cannot be written directly.

**Do:**
- Split the conditional part into its own action with `preconditions` and make it an
  `optional: true` step of a `sequence` grammar. The step is skipped when the action is
  unavailable and runs, without prompting, whenever it is, so its messages fire only when it runs.
  The game state decides, not the player; to let the player choose, use a `choice` with
  `passable: true`. `optional` is valid only on a direct sequence step.
- `move` and other selector effects: put the condition in the selector `filter`. It may read
  `game.*`, `actor.*` and `input.<id>`, so `filter: "game.property.lastRoll == 6"` selects
  nothing when the condition is false.
- `set-state`: use `if(condition, then, else)` in an `{ expr: ... }` value.
- `message`: use the first bullet. A message inside a single action always fires.
- If the branches are different player choices, make them separate actions with `preconditions`.

## A move cannot target each player's own inventory, or the opponent's

A move destination names exactly one player: `actor`, `{ param }` or `{ stateRef }`. There is no
`all`, `all-other`, or "the player the piece came from". So a single move cannot take pieces from
every player's `hand` into that same player's `stash`, and an action cannot move pieces into the
opponent's inventory. In flow hooks (no acting player) such per-player moves cannot be written at
all.

**Do:** do the move in the owning player's own action, where the destination is `actor`. When every
player must do it at a fixed point in the game (for example, move each player's starting cards of
a kind into their own `stash` after the deal), add a `turn` node with `actor: all` whose grammar
is a single action with no inputs: the engine runs it for each player in seat order without
prompting.

```yaml
- kind: turn
  id: stashStartingCards
  actor: all
  turnOrder: { kind: seat, direction: clockwise }
  grammar: { kind: action, ref: stashStartingCards }
```

If a state property already holds the player's id, `{ stateRef }` works. Record any rule change
you still need in `brief.md` under Decisions.

There is no workaround when one player's action must change every other player's own inventories
at once (for example, "each other player draws a card from their own deck"). Record it in
`brief.md` as a gap and simplify the rule.
