// ---------------------------------------------------------------------------
// Phase 4 — Full-game e2e test
//
// Validates the COMPLETE compiler pipeline: YAML spec → assembleModule →
// GameController → scripted full game → correct final state.
//
// Uses the runtime's ScriptedDriver to feed player moves. No hand-written
// game logic — the test only provides a spec file path and a move script.
// ---------------------------------------------------------------------------

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { load } from 'js-yaml';
import { validate } from '@chaincraft/gamedef/validator';
import { GameController } from '@chaincraft/runtime';
import type { GameState, GameEvent } from '@chaincraft/runtime';
import { assembleModule } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadSpec(filename: string) {
  const raw = load(
    readFileSync(
      join(__dirname, '../../../../gamedef/examples/', filename),
      'utf-8',
    ),
  );
  const result = validate(raw);
  if (!result.valid) {
    throw new Error(`${filename} failed validation: ${JSON.stringify(result.errors, null, 2)}`);
  }
  return result.spec;
}

function handPieceIds(state: GameState, playerId: string): string[] {
  const inv = state.players[playerId].inventories.hand;
  return 'pieceIds' in inv ? inv.pieceIds : [];
}

function gameInvPieceIds(state: GameState, inventoryId: string): string[] {
  const inv = state.gameInventories[inventoryId];
  return 'pieceIds' in inv ? inv.pieceIds : [];
}

function score(state: GameState, playerId: string): number {
  return Number(state.players[playerId].properties.score ?? 0);
}

// ---------------------------------------------------------------------------
// High Card — full game (3 tricks, 2 players)
// ---------------------------------------------------------------------------

describe('Compiler e2e — High Card full game', () => {
  const PLAYERS = ['alice', 'bob'];

  it('compiles spec and plays 3 tricks to completion', async () => {
    const spec = loadSpec('high-card.yaml');
    const mod = assembleModule(spec, 'high-card');

    const messages: string[] = [];
    const prompts: unknown[] = [];
    let outcome: unknown = undefined;

    const controller = new GameController(mod, {
      events: {
        onMessage: (msg) => messages.push(msg.content),
        onPrompt: (prompt) => prompts.push(prompt),
        onComplete: (o) => { outcome = o; },
      },
    });

    // Collect all observable events from the session emitter.
    // We subscribe after creating the controller but before init — the session
    // is created inside init(), so we hook the module's createSession to grab it.
    const eventLog: GameEvent[] = [];
    const origCreateSession = mod.createSession.bind(mod);
    (mod as { createSession: typeof mod.createSession }).createSession = (gameId, players) => {
      const session = origCreateSession(gameId, players);
      session.events.on((e) => eventLog.push(e));
      return session;
    };

    await controller.init('game-e2e', PLAYERS);

    // After init: onEnter hooks have fired (fillDeck, shuffle, deal, announce)
    const postInit = controller.getState();
    expect(handPieceIds(postInit, 'alice')).toHaveLength(3);
    expect(handPieceIds(postInit, 'bob')).toHaveLength(3);
    expect(gameInvPieceIds(postInit, 'deck')).toHaveLength(0);

    // Play 3 tricks (6 total turns: alice, bob × 3 rounds)
    for (let trick = 0; trick < 3; trick++) {
      for (const playerId of PLAYERS) {
        const prompt = controller.promptFor(playerId);
        expect(prompt).toBeDefined();
        expect(prompt!.input.type.kind).toBe('gamepiece-select');
        expect(prompt!.options).toBeDefined();
        expect(prompt!.options!.length).toBeGreaterThan(0);

        const cardId = prompt!.options![0];
        await controller.processAction({ playerId, value: cardId });
      }
    }

    // Final state assertions
    const finalState = controller.getState();

    for (const pid of PLAYERS) {
      expect(handPieceIds(finalState, pid)).toHaveLength(0);
    }
    expect(gameInvPieceIds(finalState, 'table')).toHaveLength(0);
    expect(gameInvPieceIds(finalState, 'discard')).toHaveLength(6);

    const totalScore = score(finalState, 'alice') + score(finalState, 'bob');
    expect(totalScore).toBe(3);

    const aliceScore = score(finalState, 'alice');
    const bobScore = score(finalState, 'bob');
    expect(Math.max(aliceScore, bobScore)).toBeGreaterThanOrEqual(2);

    const trickMessages = messages.filter((m) => m.includes('takes the trick!'));
    expect(trickMessages).toHaveLength(3);

    expect(outcome).toBeDefined();
    expect(controller.isComplete).toBe(true);

    // Event stream assertions — verify key structural events fired
    const effectEvents = eventLog.filter((e) => e.kind === 'effect:execute');
    const flowEnterEvents = eventLog.filter((e) => e.kind === 'flow:enter');
    const inputPromptEvents = eventLog.filter((e) => e.kind === 'input:prompt');
    const inputResolveEvents = eventLog.filter((e) => e.kind === 'input:resolve');
    const messageEvents = eventLog.filter((e) => e.kind === 'message:emit');

    // Setup: fillDeck + shuffle + distribute + message = at least 4 effects
    expect(effectEvents.length).toBeGreaterThanOrEqual(4);
    // 6 card plays → 6 resolves
    expect(inputResolveEvents).toHaveLength(6);
    // 6 prompts (one per card play — simultaneous turns mean 2 prompts then 2 resolves per trick)
    expect(inputPromptEvents.length).toBeGreaterThanOrEqual(6);
    // messages via event stream match outbox drain
    expect(messageEvents).toHaveLength(messages.length);
    // Flow nodes entered: at least the game root + the loop + turn nodes
    expect(flowEnterEvents.length).toBeGreaterThanOrEqual(3);

    // --- Verified outcomes log ---
    console.log('\n┌─── Compiled High Card — Verified Game Outcomes ───');
    console.log(`│ Players: ${PLAYERS.join(', ')}`);
    console.log(`│ Final scores: alice=${aliceScore}, bob=${bobScore}`);
    console.log(`│ Winner: ${aliceScore > bobScore ? 'alice' : 'bob'} (${Math.max(aliceScore, bobScore)}-${Math.min(aliceScore, bobScore)})`);
    console.log(`│ Discard pile: ${gameInvPieceIds(finalState, 'discard').length} cards`);
    console.log(`│ Messages: ${messages.join(' | ')}`);
    console.log(`│ Outcome: ${JSON.stringify(outcome)}`);
    console.log(`│ Events emitted: ${eventLog.length} total`);
    console.log(`│   flow:enter=${flowEnterEvents.length}  effect:execute=${effectEvents.length}`);
    console.log(`│   input:prompt=${inputPromptEvents.length}  input:resolve=${inputResolveEvents.length}`);
    console.log(`│   message:emit=${messageEvents.length}`);
    console.log('├─── Full event trace (chronological) ───');
    for (const e of eventLog) {
      switch (e.kind) {
        case 'flow:enter':
          console.log(`│  [flow:enter]   nodeId=${e.nodeId}  type=${e.nodeType}`);
          break;
        case 'flow:phase':
          console.log(`│  [flow:phase]   nodeId=${e.nodeId}  phase=${e.phase}`);
          break;
        case 'flow:exit':
          console.log(`│  [flow:exit]    nodeId=${e.nodeId}`);
          break;
        case 'effect:execute': {
          const defStr = JSON.stringify(e.context.effectDef);
          const inputsStr = Object.keys(e.context.actionInputs).length
            ? `  inputs=${JSON.stringify(e.context.actionInputs)}`
            : '';
          console.log(`│  [effect:exec]  [${e.effectKind}] ${e.effectId}  actor=${e.context.actorId ?? 'game'}  def=${defStr}${inputsStr}`);
          break;
        }
        case 'input:prompt': {
          const optStr = e.suspension.options
            ? `  options=[${e.suspension.options.slice(0, 3).join(',')}${e.suspension.options.length > 3 ? '…' : ''}]`
            : '';
          console.log(`│  [input:prompt] player=${e.playerId}  inputId=${e.suspension.input.id}  kind=${e.suspension.input.type.kind}${optStr}`);
          break;
        }
        case 'input:resolve':
          console.log(`│  [input:resolve] player=${e.playerId}  value=${JSON.stringify(e.value)}`);
          break;
        case 'message:emit':
          console.log(`│  [message:emit] "${e.message.content}"`);
          break;
        case 'game:init':
          console.log(`│  [game:init]    gameId=${e.gameId}  players=[${e.players.join(',')}]`);
          break;
        case 'game:complete':
          console.log(`│  [game:complete] outcome=${JSON.stringify(e.outcome)}`);
          break;
      }
    }
    console.log('└───────────────────────────────────────────────────\n');
  });
});

// ---------------------------------------------------------------------------
// Liar's Dice — the bid rule narrows prompts and rejects illegal bids
// ---------------------------------------------------------------------------

describe("Compiler e2e — Liar's Dice bid validation", () => {
  const range = (low: number, high: number) =>
    Array.from({ length: high - low + 1 }, (_, i) => low + i);

  it("offers only bids above the current bid and rejects an illegal face value", async () => {
    const controller = new GameController(assembleModule(loadSpec("liars-dice.yaml"), "liars-dice"), {});
    await controller.init("ld", ["alice", "bob"]);

    // Opening bid: 5 x threes.
    await controller.processAction({ playerId: "alice", value: 5 });
    await controller.processAction({ playerId: "alice", value: 3 });

    await controller.processAction({ playerId: "bob", value: { kind: "act", actionId: "makeBid" } });
    expect(controller.promptFor("bob")!.options).toEqual(range(5, 30));

    await controller.processAction({ playerId: "bob", value: 5 });
    expect(controller.promptFor("bob")!.options).toEqual([4, 5, 6]);

    const rejected = controller.processAction({ playerId: "bob", value: 2 });
    await expect(rejected).rejects.toMatchObject({
      name: "IllegalActionError",
      inputId: "faceValue",
      validationMessage: "Bid a higher quantity, or the same quantity with a higher face value.",
    });

    await controller.processAction({ playerId: "bob", value: 4 });
    const state = controller.getState();
    expect(state.gameProperties.currentBidQuantity).toBe(5);
    expect(state.gameProperties.currentBidFace).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Liar's Dice — resolveChallenge is a native set-state using aggregators
// ---------------------------------------------------------------------------

describe("Compiler e2e — Liar's Dice challenge resolution", () => {
  // Alice holds three 3s, bob holds two 3s: five 3s in play.
  const ALICE_FACES = [3, 3, 3, 1, 1];
  const BOB_FACES = [3, 3, 1, 1, 1];

  async function playChallenge(bidQuantity: number) {
    const mod = assembleModule(loadSpec("liars-dice.yaml"), "liars-dice");
    let live: ReturnType<typeof mod.createSession> | undefined;
    const origCreateSession = mod.createSession.bind(mod);
    (mod as { createSession: typeof mod.createSession }).createSession = (gameId, players) => {
      live = origCreateSession(gameId, players);
      return live;
    };

    const controller = new GameController(mod, {});
    await controller.init("ld-challenge", ["alice", "bob"]);

    const faces: Record<string, number[]> = { alice: ALICE_FACES, bob: BOB_FACES };
    for (const [playerId, playerFaces] of Object.entries(faces)) {
      const cup = live!.state.players[playerId].inventories.playerCup;
      const pieceIds = "pieceIds" in cup ? cup.pieceIds : [];
      expect(pieceIds).toHaveLength(5);
      pieceIds.forEach((id, i) => { live!.state.gamepieces[id].faceValue = playerFaces[i]; });
    }

    await controller.processAction({ playerId: "alice", value: bidQuantity });
    await controller.processAction({ playerId: "alice", value: 3 });
    await controller.processAction({ playerId: "bob", value: { kind: "act", actionId: "challenge" } });
    return controller.getState();
  }

  const cupSize = (state: GameState, playerId: string) => {
    const cup = state.players[playerId].inventories.playerCup;
    return "pieceIds" in cup ? cup.pieceIds.length : -1;
  };

  it("challenger loses when the bid quantity equals the actual count", async () => {
    const state = await playChallenge(5);
    expect(state.gameProperties.roundLoser).toBe("bob");
    expect(cupSize(state, "bob")).toBe(4);
    expect(cupSize(state, "alice")).toBe(5);
  });

  it("challenger loses when the actual count exceeds the bid quantity", async () => {
    const state = await playChallenge(4);
    expect(state.gameProperties.roundLoser).toBe("bob");
    expect(cupSize(state, "bob")).toBe(4);
    expect(cupSize(state, "alice")).toBe(5);
  });

  it("bidder loses when the actual count is below the bid quantity", async () => {
    const state = await playChallenge(6);
    expect(state.gameProperties.roundLoser).toBe("alice");
    expect(cupSize(state, "alice")).toBe(4);
    expect(cupSize(state, "bob")).toBe(5);
  });

  it("rolls every dealt die to a face in 1..6 during setup", async () => {
    const controller = new GameController(assembleModule(loadSpec("liars-dice.yaml"), "liars-dice"), {});
    await controller.init("ld-roll", ["alice", "bob"]);

    const state = controller.getState();
    for (const playerId of ["alice", "bob"]) {
      const cup = state.players[playerId].inventories.playerCup;
      const pieceIds = "pieceIds" in cup ? cup.pieceIds : [];
      expect(pieceIds).toHaveLength(5);
      for (const id of pieceIds) {
        expect([1, 2, 3, 4, 5, 6]).toContain(state.gamepieces[id].faceValue);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Liar's Dice — full 3-player game on the real seeded RNG. The script fixes
// each round's loser and raise chain; bids are derived from the dice that
// were actually rolled.
// ---------------------------------------------------------------------------

describe("Compiler e2e — Liar's Dice full game", () => {
  const SEATS = ["alice", "bob", "carol"];
  type Bid = [quantity: number, face: number];
  type Raise = "quantity" | "face";

  interface Round {
    raises: Raise[]; // how each bid after the opening one outbids its predecessor
    loser: string; // must be the final bidder or the challenger
    countAboveBid?: true; // challenger loses with count > bid instead of count == bid
  }

  // Alice outlasts bob and carol. Carol is eliminated mid-game (round 10, last seat, so the
  // next round wraps to alice), then bob ends the game in round 13.
  const ROUNDS: Round[] = [
    { raises: [], loser: "bob" },
    { raises: ["quantity"], loser: "carol" },
    { raises: ["face", "quantity"], loser: "carol", countAboveBid: true },
    { raises: [], loser: "alice" },
    { raises: ["face"], loser: "bob" },
    { raises: ["quantity", "face"], loser: "bob", countAboveBid: true },
    { raises: [], loser: "carol" },
    { raises: ["face"], loser: "alice" },
    { raises: ["quantity"], loser: "carol" },
    { raises: [], loser: "carol" },
    { raises: ["quantity", "face"], loser: "alice" },
    { raises: ["face"], loser: "bob" },
    { raises: [], loser: "bob" },
  ];

  const range = (low: number, high: number) =>
    Array.from({ length: Math.max(high - low + 1, 0) }, (_, i) => low + i);

  const cupIds = (state: GameState, playerId: string) => {
    const cup = state.players[playerId].inventories.playerCup;
    return "pieceIds" in cup ? cup.pieceIds : [];
  };

  // First live seat clockwise from `from`, starting at `from` itself when inclusive.
  const liveSeatFrom = (from: string, alive: string[], inclusive: boolean) => {
    const start = SEATS.indexOf(from) + (inclusive ? 0 : 1);
    for (let k = 0; k < SEATS.length; k++) {
      const seat = SEATS[(start + k) % SEATS.length];
      if (alive.includes(seat)) return seat;
    }
    throw new Error("no live seats");
  };

  const faceCounts = (state: GameState) => {
    const counts = new Map<number, number>();
    for (const seat of SEATS) {
      for (const id of cupIds(state, seat)) {
        const face = state.gamepieces[id].faceValue as number;
        counts.set(face, (counts.get(face) ?? 0) + 1);
      }
    }
    return counts;
  };

  // Final bid sets the outcome against the real dice; earlier bids are stepped down from it.
  function planBids(counts: Map<number, number>, round: Round, bidderLoses: boolean): Bid[] | undefined {
    for (const [face, n] of counts) {
      const quantity = bidderLoses ? n + 1 : round.countAboveBid ? n - 1 : n;
      if (quantity < 1) continue;
      const bids: Bid[] = [[quantity, face]];
      for (const raise of [...round.raises].reverse()) {
        const [q, f] = bids[0];
        if (raise === "quantity" ? q <= 1 : f <= 1) break;
        bids.unshift(raise === "quantity" ? [q - 1, f] : [q, f - 1]);
      }
      if (bids.length === round.raises.length + 1) return bids;
    }
    return undefined;
  }

  it("plays 3 players through bids, raises and challenges until one survivor wins", async () => {
    const controller = new GameController(assembleModule(loadSpec("liars-dice.yaml"), "liars-dice"), {
      events: {
        onMessage: (msg) => messages.push(msg.content),
        onComplete: (o) => { outcome = o; },
      },
    });
    const messages: string[] = [];
    let outcome: unknown = undefined;
    await controller.init("ld-full-3p", SEATS);

    const dice: Record<string, number> = { alice: 5, bob: 5, carol: 5 };
    let alive = [...SEATS];
    let starter = liveSeatFrom("alice", alive, true);

    for (const [i, round] of ROUNDS.entries()) {
      try {
        const messagesBefore = messages.length;
        const roundStart = controller.getState();
        const counts = faceCounts(roundStart);
        expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(alive.reduce((n, p) => n + dice[p], 0));

        // Seat order after the starter (live seats only) fixes who bids last and who challenges.
        const bidderCount = round.raises.length + 1;
        const bidders: string[] = [];
        for (let b = 0, seat = starter; b < bidderCount; b++, seat = liveSeatFrom(seat, alive, false)) {
          bidders.push(seat);
        }
        const finalBidder = bidders[bidders.length - 1];
        const challenger = liveSeatFrom(finalBidder, alive, false);
        if (round.loser !== finalBidder && round.loser !== challenger) {
          throw new Error(`script loser ${round.loser} is neither bidder ${finalBidder} nor challenger ${challenger}`);
        }
        const bids = planBids(counts, round, round.loser === finalBidder);
        if (!bids) throw new Error("no rolled face lets the script build this bid chain");

        let prev: Bid = [0, 0];
        for (const [j, [quantity, face]] of bids.entries()) {
          const actor = bidders[j];
          expect(controller.currentPrompt?.awaiting).toBe(actor);
          if (j > 0) {
            const choice = controller.currentPrompt!.input.type;
            expect(choice.kind).toBe("action-select");
            expect(choice.kind === "action-select" ? choice.actions : []).toEqual(["makeBid", "challenge"]);
            await controller.processAction({ playerId: actor, value: { kind: "act", actionId: "makeBid" } });
          }

          const quantityPrompt = controller.promptFor(actor)!;
          expect(quantityPrompt.input.id).toBe("quantity");
          // Same quantity is only legal while a higher face remains.
          expect(quantityPrompt.options).toEqual(range(prev[1] === 6 ? prev[0] + 1 : Math.max(prev[0], 1), 30));
          await controller.processAction({ playerId: actor, value: quantity });

          const facePrompt = controller.promptFor(actor)!;
          expect(facePrompt.input.id).toBe("faceValue");
          expect(facePrompt.options).toEqual(quantity > prev[0] ? range(1, 6) : range(prev[1] + 1, 6));
          await controller.processAction({ playerId: actor, value: face });

          prev = [quantity, face];
        }

        expect(controller.currentPrompt?.awaiting).toBe(challenger);
        const standing = controller.getState().gameProperties;
        expect(standing.currentBidQuantity).toBe(prev[0]);
        expect(standing.currentBidFace).toBe(prev[1]);
        expect(standing.currentBidder).toBe(finalBidder);

        // Independent recount of the rule: the challenger loses when the count meets the bid.
        const actualCount = counts.get(prev[1]) ?? 0;
        expect(actualCount >= prev[0] ? challenger : finalBidder).toBe(round.loser);

        await controller.processAction({ playerId: challenger, value: { kind: "act", actionId: "challenge" } });

        dice[round.loser] -= 1;
        alive = SEATS.filter((p) => dice[p] > 0);
        const afterChallenge = controller.getState();
        expect(messages.slice(messagesBefore)).toEqual([
          ...bids.map(([q, f], j) => `${bidders[j]} bids ${q} dice showing ${f}s.`),
          `The bid of ${prev[0]} ${prev[1]}s by ${finalBidder} was challenged — ${round.loser} loses a die.`,
        ]);
        expect(afterChallenge.gameProperties.roundLoser).toBe(round.loser);
        for (const seat of SEATS) {
          expect(cupIds(afterChallenge, seat)).toHaveLength(dice[seat]);
          expect(Boolean(afterChallenge.players[seat].properties.eliminated)).toBe(dice[seat] === 0);
        }

        if (i < ROUNDS.length - 1) {
          // startNextRound runs without input, so the next round is already open and the
          // loser (or the next live seat when the loser was just eliminated) is prompted.
          expect(controller.isComplete).toBe(false);
          expect(afterChallenge.gameProperties.currentBidQuantity).toBe(0);
          expect(afterChallenge.gameProperties.currentBidFace).toBe(0);
          expect(afterChallenge.gameProperties.currentBidder).toBe("");
          expect(afterChallenge.gameProperties.challengeMade).toBe(false);
          starter = liveSeatFrom(round.loser, alive, true);
          expect(controller.pendingPrompts.size).toBe(1);
          expect(controller.currentPrompt?.awaiting).toBe(starter);
          expect(controller.currentPrompt?.input.id).toBe("quantity");
        }
      } catch (err) {
        (err as Error).message = `round ${i + 1}: ${(err as Error).message}`;
        throw err;
      }
    }

    expect(dice).toEqual({ alice: 2, bob: 0, carol: 0 });
    expect(controller.isComplete).toBe(true);
    expect(outcome).toMatchObject({ reason: "win-conditions", winnerIds: ["alice"] });
  });
});

