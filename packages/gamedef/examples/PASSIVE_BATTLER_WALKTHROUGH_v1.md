# Passive Battler: the walkthrough

**In your own vocabulary: BLEED is the shape of your lifesteal example (it fires when its
holder triggers an effect), and ARMOR and KINDLE are the shape of your thorns example (they
fire when another player triggers an effect targeting their holder).**

This is the acceptance test for the passive layer, written in prose for someone who did not
write the game. It accompanies `passive-battler.yaml` in this folder.

---

## How to re-run this exactly

Every number below marked OBSERVED came out of a real run, and **you can reproduce it byte
for byte**. The spec declares `rng.seedSource: fixed`, which resolves to a constant seed and
ignores the game id entirely, so the shuffle is the same permutation on every run and the
deal is identical every time. The script is simply "always play the leftmost card in hand",
six times, alternating seats.

Both gates pass on this spec as it stands: the validator returns `{"valid": true,
"errors": []}` and the compiler returns `compile: OK`.

One thing that is load bearing and easy to destroy by accident: **the order of the eight
catalog entries decides the deal.** It is not alphabetical and not grouped by class. That
order is what puts both thief cards in Player 2's opening hand, which is what makes bleed
stack twice below. Reordering those eight entries changes the deal and nothing else.

---

## What each player starts with

Both players start at **20 life, 0 bleed, 0 spellPower**.

Eight cards exist in total, one piece each, from a shared catalog. Each carries a damage
number, a bleed number (1 on the two thief cards, 0 on the other six) and a class name. At
setup they are shuffled in a shared pile and dealt out: **2 cards to each player's hand and
2 to each player's own deck**. Nothing is left over.

For this match, **Player 1 is the warrior and Player 2 is the mage.** Note that any seat may
play any class's card: the classes live on the players, not on their cards. That is
deliberate, and it is what lets a two player match exercise all three class passives at once.
This is a coverage game, not a balanced one.

The deal, OBSERVED:

| | hand | deck |
|---|---|---|
| **P1** (warrior) | firestorm (4 dmg), shieldBash (3 dmg) | arcBolt (3 dmg), cleave (4 dmg) |
| **P2** (mage) | serratedEdge (2 dmg, **bleed 1**), gutCut (3 dmg, **bleed 1**) | ember (2 dmg), hammerBlow (5 dmg) |

## What a turn does

Three rounds. In each round Player 1 acts fully and then Player 2 does, never at the same
time. Acting means playing one card, which does four things in this fixed order:

1. **The card leaves your hand** and goes to the shared discard. This is the moment bleed
   watches, which is why it comes first: you pay for your wound before your blow lands.
2. **Your opponent loses life** equal to the card's damage.
3. **Your opponent's bleed rises** by the card's bleed number, which is 0 on six of the
   eight cards and 1 on the two thief cards.
4. **You draw a replacement** from your own deck. On the final round the deck is already
   empty and the draw does nothing, which is intended and safe.

After the third round the match ends and the winner is whoever has the most life left.

## The three passives, in one sentence each

- **ARMOR** (warrior, on the player role): incoming damage to this player is reduced by 2
  before it lands. Fires when another player targets its holder.
- **BLEED** (carried by any player, declared on all three roles): whenever a player whose
  bleed is above zero plays a card, they lose that many life. Fires on its holder's own
  action. It never fires on a clock and it never decays.
- **KINDLE** (mage, on the player role): being damaged raises this player's spellPower by 1,
  and every card this player plays deals its own damage plus their spellPower.

---

## Table 1: what happens TODAY. OBSERVED.

This is the real transcript of the base game. **No passive fires anywhere in it**, because
the compiler reads no passive declaration at all: all six declarations are dropped silently
between the validator and the compiled module. Watch Player 1 carry bleed from step 2 onward
and never lose a point of life to it.

| Step | Who | Plays | Damage dealt | P1 life | P1 bleed | P2 life | P2 spellPower |
|---|---|---|---|---|---|---|---|
| start | | | | 20 | 0 | 20 | 0 |
| 1 | P1 | firestorm | 4 | 20 | 0 | **16** | 0 |
| 2 | P2 | serratedEdge | 2 (+1 bleed) | **18** | **1** | 16 | 0 |
| 3 | P1 | shieldBash | 3 | 18 | 1 | **13** | 0 |
| 4 | P2 | gutCut | 3 (+1 bleed) | **15** | **2** | 13 | 0 |
| 5 | P1 | arcBolt | 3 | 15 | 2 | **10** | 0 |
| 6 | P2 | ember | 2 | **13** | 2 | 10 | 0 |

**Result, OBSERVED:** `{"reason":"win-conditions","winnerIds":["p1"]}`, Player 1 at 13 to
Player 2's 10. The declared win condition really is applied, and the match names a winner.

Three things in that table are the whole problem in miniature. Bleed reaches 2 and costs
Player 1 nothing. spellPower never leaves 0, because nothing writes it. And Player 1's armor
never reduces anything, so all 7 points of incoming damage land in full.

---

## Table 2: what SHOULD happen once the passive layer lands. SPECIFICATION.

**Nothing in this table has been observed. It is the specification.** It is what the same six
plays should produce when passive declarations are read, subscribed and executed. The plays,
the deal and the card numbers are identical to Table 1; only the passives are added.

The bold entries in the last four columns are the values that differ from Table 1.

| Step | Who | Plays | What fires | P1 life | P1 bleed | P2 life | P2 spellPower |
|---|---|---|---|---|---|---|---|
| start | | | | 20 | 0 | 20 | 0 |
| 1 | P1 | firestorm (4) | P1 has no bleed, so nothing docks. 4 lands on P2 in full. **KINDLE (gain)** fires: P2 was damaged, spellPower 0 to 1. | 20 | 0 | 16 | **1** |
| 2 | P2 | serratedEdge (2, bleed 1) | P2 has no bleed, so nothing docks. **KINDLE (strike)** fires: 2 + spellPower 1 = **3 outgoing**. **ARMOR** fires: 3 reduced by 2 = **1 landing**. Then the card's bleed 1 goes on P1. | **19** | 1 | 16 | 1 |
| 3 | P1 | shieldBash (3) | **BLEED fires**, first dock: P1 is at bleed 1, so P1 loses **1** as the card leaves hand. Then 3 lands on P2. **KINDLE (gain)**: spellPower 1 to 2. | **18** | 1 | 13 | **2** |
| 4 | P2 | gutCut (3, bleed 1) | **KINDLE (strike)**: 3 + 2 = **5 outgoing**. **ARMOR**: 5 reduced by 2 = **3 landing**. Then bleed rises to **2**, the second stack. | **15** | **2** | 13 | 2 |
| 5 | P1 | arcBolt (3) | **BLEED fires**, second dock, and it is bigger: P1 is at bleed 2, so P1 loses **2**. Then 3 lands on P2. **KINDLE (gain)**: spellPower 2 to 3. | **13** | 2 | 10 | **3** |
| 6 | P2 | ember (2) | **KINDLE (strike)**: 2 + 3 = **5 outgoing**. **ARMOR**: 5 reduced by 2 = **3 landing**. ember carries no bleed. | **10** | 2 | 10 | 3 |

**Bleed stacks twice and is paid twice, which is the point of the table:** it goes 0 to 1 at
step 2 and 1 to 2 at step 4, and Player 1 pays 1 at step 3 and 2 at step 5. Accumulation is
provable by reading the column, not by trusting the prose.

**Expected result, SPECIFIED: a 10 to 10 tie.** The win condition ranks on life, highest
wins, and its tiebreak defaults to `all-win`, so **both players should be named winners**.
That is the pass condition for this acceptance test.

The tie is a coincidence of the numbers, not a design goal, and it is worth reading as the
proof that the passives are doing real work: armor prevents 6, kindle adds 6, and bleed costs
its holder 3, which is enough to turn an observed 3 point win for Player 1 into a dead heat.
If you would rather the acceptance test ended decisively, changing any single card's damage
by one point breaks the tie; we have not done that, because the numbers above are the ones
that are actually in the file.

---

## Four questions this match cannot answer by itself

These are genuine ambiguities, not complaints. Each one changes a number in Table 2, so the
table above states our reading and this section says where we guessed.

1. **Does a scope `target` passive fire on damage a player does to themselves?** Bleed docks
   Player 1's own life with Player 1 as both the actor and the target, and the bus resolves
   scope `target` by matching the owner against the event's target id, without checking that
   the actor is somebody else. Read literally, **armor would cancel the bleed dock**, which
   would make bleed cost nothing at all. Table 2 assumes the opposite, matching your own
   definition of shape two as "another player triggers an effect targeting them". Same
   question for kindle's gain half: it should not fire on self-inflicted damage either. That
   case does not arise here only because Player 2 never carries bleed.
2. **Inside a passive's effects, whose properties does a var path read?** Kindle's strike
   half needs its HOLDER's spellPower, but a var path in an effect value currently resolves
   against the event's target, which would read the victim's spellPower instead. Table 2
   assumes the holder's. This is the difference between kindle working and kindle being
   silently wrong.
3. **Can adjust express "reduce by 2, floored at zero reduction"?** Today adjust moves the
   resulting total rather than the size of the change, so `delta: 2` means "end 2 higher than
   you would have". In this specific match the two readings agree at every step, because
   every hit that reaches Player 1 is 3 or 5 and both exceed armor 2. They would diverge the
   moment a 1 damage card is played, where the same armor would heal its holder above where
   they started. The transcript is not sensitive to this; a real game would be.
4. **Does a passive's own effect re-trigger it?** Bleed is written with a move trigger
   specifically to avoid finding out. Written the other way, as a state-write trigger scoped
   to the actor, which is the literal reading of your lifesteal example, bleed's own life
   write would match bleed's own trigger and recurse.

---

## What to check when the layer lands

The acceptance test passes when, with no change to `passive-battler.yaml` beyond whatever the
new vocabulary requires:

1. The same six plays produce **Table 2's numbers exactly**, ending 10 to 10 with both
   players named winners.
2. **Bleed reaches 2 and is paid twice**, 1 at step 3 and 2 at step 5.
3. **spellPower reaches 3**, having risen once per time Player 2 was damaged.
4. **Armor reduces three separate incoming hits**, and does not touch Player 1's own bleed.
5. Whatever is still unsupported is **said out loud**. Today all six passive declarations are
   dropped between a clean validator result and a clean compile with no warning on any
   channel, which is how a spec can be a third fiction and still show two green gates.
