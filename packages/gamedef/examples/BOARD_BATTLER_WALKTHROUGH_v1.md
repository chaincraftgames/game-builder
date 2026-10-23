# Board Battler: the walkthrough

**The three keywords in your own vocabulary: LIFESTEAL fires when its holder triggers an
effect, THORNS fires when another player triggers an effect targeting its holder, and FREEZE
is the piece-level one, a property on the piece plus a condition on the selector plus an
end-of-turn clear.**

This accompanies `board-battler.yaml` in this folder. It is the second acceptance test.
`passive-battler.yaml` and its own walkthrough are unchanged and cover a different question.

**Armor is deliberately not here.** It is the only one of these that has to intercept a write
while it is in flight rather than react after one, so it is the only one that needs the adjust
executor and the clamping question that comes with it. Second wave, on purpose.

---

## What is observed and what is not

**Everything marked OBSERVED came out of a real run** of this exact file, driven in-process
through the runtime's own `GameController`. The seed is fixed, so the deal is the same on
every run of that path.

**The reproducibility claim is scoped to that path and no other.** This has NOT been played
over the wire through game-server and the surface, and a run of the previous spec over the
wire did not match its in-process run, so please do not read "reproducible" as "reproducible
everywhere" until someone has played this one over a socket. Both gates pass on the file as it
stands: validator `{"valid": true, "errors": []}`, compiler `compile: OK`.

## What each player starts with

30 life each. Eight cards total, one piece each, shuffled and dealt 2 to each hand and 2 to
each deck. Six are creatures carrying a power and a defense; two are freeze spells.

| card | kind | power/defense | carries |
|---|---|---|---|
| ironOak | creature | 2/6 | |
| swiftFang | creature | 4/2 | |
| duskRaider | creature | 3/4 | |
| stoneWarden | creature | 1/7 | |
| bloodHunter | creature | 3/3 | **lifesteal** (bound, inert) |
| thornBeast | creature | 2/5 | **thorns** (bound, inert) |
| frostBind | spell | | freeze |
| rimeSnare | spell | | freeze |

## What a turn does

Three rounds. Within a round one seat acts fully and then the other. A turn is one action,
chosen from four: play a creature to your field, attack a creature, attack the opposing player,
or cast a freeze. Creatures stay on the field once played. At the end of each round every
creature thaws.

---

## Table 1: the board and combat. OBSERVED.

A real run, first two rounds. This is the part that already works.

| Step | Who | Action | Result | p1 field | p2 field |
|---|---|---|---|---|---|
| setup | | deal | 30 life each | (empty) | (empty) |
| 1 | p1 | play thornBeast | creature lands | thornBeast 2/5 | (empty) |
| 2 | p2 | play ironOak | creature lands | thornBeast 2/5 | ironOak 2/6 |
| 3 | p1 | attack ironOak with thornBeast | **both take the other's power** | thornBeast 2/**3** | ironOak 2/**4** |
| 4 | p1 | attack the player with thornBeast | p2 life 30 to **28** | thornBeast 2/3 | ironOak 2/4 |

Creatures persisted across the round boundary untouched, combat damage was read off the
opposing piece rather than hardcoded, and a creature struck the opposing player directly. The
match ran to completion and named winners through the declared win condition.

## Table 2: freeze. OBSERVED, including the part that does not work.

| Moment | frozen flags | what it proves |
|---|---|---|
| end of round 1 | p1:thornBeast=false, p2:ironOak=false | default holds |
| p1 casts freeze on ironOak, mid-round | p2:**ironOak=true** | **the write half works.** The flag is set, on the right piece, in the opposing player's field |
| p2 is then asked to attack | attacker options offered: **["ironOak"]** | **the condition half is missing.** The frozen creature is still offered as a legal attacker, and it attacked |
| after p2 acted, round ends | p2:ironOak=false | **the clear works**, without a `where` clause |

**The clear did not need the where clause.** Setting `frozen` to false on a creature that is
already thawed is a harmless no-op, so sweeping every creature does exactly what sweeping only
the frozen ones would do. The clause becomes load-bearing when the write is not idempotent, not
here. Your proposed shape is written out in the spec next to the working version anyway, so it
is on the record.

**But the clear's TIMING is a real problem, and it is not about which pieces are swept.**
There is no per-player end-of-turn hook: a turn node covers every player and its hooks fire
once for the node with no acting player bound. So the only boundary available is end of round,
and freeze comes out asymmetric, both halves observed:

- cast by the **first** player to act in a round, the flag survives the opponent's whole turn
  and clears after. This is what freeze should do.
- cast by the **last** player to act in a round, the turn node completes immediately, the thaw
  runs, and **the flag is gone before its victim is ever asked to act.** It never bites, even
  once the selector condition exists.

A per-player end-of-turn hook fixes this and a `where` clause does not.

## Table 3: lifesteal and thorns. SPECIFICATION, nothing observed.

Neither fires. Both are declared in the schema's passive vocabulary and bound to their cards
through `passiveBindings`, and the compiler reads no passive declaration of any kind, so both
are dropped silently between a clean validate and a clean compile.

| | should fire when | should do | today |
|---|---|---|---|
| **lifesteal** (bloodHunter) | its controller deals damage | that player heals 2 | nothing |
| **thorns** (thornBeast) | an opponent targets it | the attacking player takes 2 | nothing |

Three things to know before building them, all read out of the runtime rather than guessed:

1. **"Heal that amount" is not expressible.** A passive sees the resulting total, not the size
   of the change, which is why your own lifesteal example heals a flat 1 and this one heals a
   flat 2. If a passive could read the delta, this becomes real lifesteal in one edit.
2. **A piece-scoped defensive passive cannot match under today's rule.** `update` really does
   emit a state-write for a piece property, carrying path `gamepiece.property.defense` and the
   **piece** id as `targetId`. But trigger matching decides scope `target` by comparing the
   subscription's `ownerId`, a **player**, against that `targetId`. Those can never be equal.
   Ownership resolution for piece events is part of this work.
3. **Thorns hits the attacking player, not the attacking creature**, exactly as your own thorns
   example does with `target: trigger-actor`. Hitting the creature would need a reference to the
   triggering piece, and the passive vocabulary has none.

---

## What the acceptance test checks

1. A frozen creature is **not offered** as an attacker, and an unfrozen one is.
2. Freeze cast by either seat survives until its victim has had a turn, so it bites both ways.
3. bloodHunter's controller **heals 2** when they deal damage.
4. An attack on thornBeast costs the attacking player **2 life**.
5. Whatever still cannot be done is **said out loud**. Today six passive declarations across
   two specs are dropped between two green gates with no warning on any channel.

## The three gaps this file runs into, in your terms

- **No death check.** A creature at zero defense is never removed: there is no death or
  threshold concept in the runtime, and the effect-level piece selector has no filter field, so
  no effect can even pick out the pieces at zero. The hook already fires though, `update` emits
  that `gamepiece.property.*` state-write; nothing subscribes and the bus is never constructed.
- **Preconditions are never read.** The action assembler maps only id, label, description,
  inputs and effects. An action carrying an impossible precondition was still offered and still
  executed. Nothing in this file gates anything, which is why it has no costs and no
  once-per-turn.
- **A filter on a gamepiece-select input crashes the runtime.** `TypeError: type.filter is not
  a function`, thrown mid-match when the input is reached, past both green gates. This is where
  freeze's own condition has to live, so it is the one that matters most here.
