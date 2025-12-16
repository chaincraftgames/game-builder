/**
 * Tests for StateDelta Operations
 * 
 * Validates all state delta operations work correctly and handle errors appropriately.
 */

import { describe, expect, it } from "@jest/globals";
import {
  applyStateDeltas,
  validateStateDeltas,
  StateDeltaOp,
  hasTemplateVariables,
  resolveTemplates,
  resolveStateDeltaTemplates,
  extractTemplateVariables,
} from "../statedelta.js";

describe("StateDelta Operations", () => {
  describe("set operation", () => {
    it("should set a value at a simple path", () => {
      const state = { game: { phase: "setup" } };
      const deltas: StateDeltaOp[] = [
        { op: "set", path: "game.phase", value: "playing" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.phase).toBe("playing");
      // Original state should be unchanged
      expect(state.game.phase).toBe("setup");
    });

    it("should create nested paths that don't exist", () => {
      const state = { game: {} };
      const deltas: StateDeltaOp[] = [
        { op: "set", path: "game.scoring.round", value: 1 },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.scoring.round).toBe(1);
    });

    it("should set values in player objects", () => {
      const state = { 
        players: { 
          p1: { score: 0 }, 
          p2: { score: 0 } 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { op: "set", path: "players.p1.score", value: 10 },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.players.p1.score).toBe(10);
      expect(result.newState.players.p2.score).toBe(0);
    });
  });

  describe("increment operation", () => {
    it("should increment a numeric value", () => {
      const state = { game: { round: 1 } };
      const deltas: StateDeltaOp[] = [
        { op: "increment", path: "game.round", value: 1 },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.round).toBe(2);
    });

    it("should support negative amounts (decrement)", () => {
      const state = { players: { p1: { lives: 3 } } };
      const deltas: StateDeltaOp[] = [
        { op: "increment", path: "players.p1.lives", value: -1 },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.players.p1.lives).toBe(2);
    });

    it("should fail if path is not a number", () => {
      const state = { game: { phase: "playing" } };
      const deltas: StateDeltaOp[] = [
        { op: "increment", path: "game.phase", value: 1 },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].error).toContain("not a number");
    });
  });

  describe("append operation", () => {
    it("should append a value to an array", () => {
      const state = { game: { history: ["event1"] } };
      const deltas: StateDeltaOp[] = [
        { op: "append", path: "game.history", value: "event2" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.history).toEqual(["event1", "event2"]);
    });

    it("should append objects to an array", () => {
      const state = { 
        game: { 
          rounds: [{ round: 1, winner: "p1" }] 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "append", 
          path: "game.rounds", 
          value: { round: 2, winner: "p2" } 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.rounds).toHaveLength(2);
      expect(result.newState.game.rounds[1].winner).toBe("p2");
    });

    it("should fail if path is not an array", () => {
      const state = { game: { phase: "playing" } };
      const deltas: StateDeltaOp[] = [
        { op: "append", path: "game.phase", value: "test" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(false);
      expect(result.errors![0].error).toContain("not an array");
    });
  });

  describe("delete operation", () => {
    it("should delete a simple property", () => {
      const state = { 
        game: { 
          phase: "playing", 
          tempData: "remove-me" 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { op: "delete", path: "game.tempData" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.tempData).toBeUndefined();
      expect(result.newState.game.phase).toBe("playing");
    });

    it("should delete a nested property", () => {
      const state = { 
        players: { 
          p1: { score: 10, tempFlag: true } 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { op: "delete", path: "players.p1.tempFlag" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.players.p1.tempFlag).toBeUndefined();
      expect(result.newState.players.p1.score).toBe(10);
    });

    it("should handle deleting non-existent paths gracefully", () => {
      const state = { game: { phase: "playing" } };
      const deltas: StateDeltaOp[] = [
        { op: "delete", path: "game.nonexistent" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
    });
  });

  describe("transfer operation", () => {
    it("should transfer a numeric value between paths", () => {
      const state = { 
        players: { 
          p1: { coins: 10 }, 
          p2: { coins: 5 } 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "transfer", 
          fromPath: "players.p1.coins", 
          toPath: "players.p2.coins", 
          value: 3 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.players.p1.coins).toBe(7);
      expect(result.newState.players.p2.coins).toBe(8);
    });

    it("should transfer entire value if amount not specified", () => {
      const state = { 
        game: { pot: 20, winner: { prize: 0 } } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "transfer", 
          fromPath: "game.pot", 
          toPath: "game.winner.prize" 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.pot).toBe(0);
      expect(result.newState.game.winner.prize).toBe(20);
    });

    it("should fail if transfer amount exceeds source value", () => {
      const state = { 
        players: { 
          p1: { coins: 5 }, 
          p2: { coins: 0 } 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "transfer", 
          fromPath: "players.p1.coins", 
          toPath: "players.p2.coins", 
          value: 10 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(false);
      expect(result.errors![0].error).toContain("Cannot transfer");
    });

    it("should initialize destination to 0 if it doesn't exist", () => {
      const state = { 
        players: { 
          p1: { coins: 10 }, 
          p2: {} 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "transfer", 
          fromPath: "players.p1.coins", 
          toPath: "players.p2.coins", 
          value: 5 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.players.p1.coins).toBe(5);
      expect(result.newState.players.p2.coins).toBe(5);
    });

    it("should fail if source is not a number", () => {
      const state = { 
        game: { phase: "playing" }, 
        players: { p1: { coins: 0 } } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "transfer", 
          fromPath: "game.phase", 
          toPath: "players.p1.coins", 
          value: 5 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(false);
      expect(result.errors![0].error).toContain("not a number");
    });
  });

  describe("merge operation", () => {
    it("should merge properties into an object", () => {
      const state = { 
        game: { 
          phase: "playing", 
          round: 1 
        } 
      };
      const deltas: StateDeltaOp[] = [
        { 
          op: "merge", 
          path: "game", 
          value: { round: 2, score: 100 } 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.phase).toBe("playing");
      expect(result.newState.game.round).toBe(2);
      expect(result.newState.game.score).toBe(100);
    });

    it("should create object if path doesn't exist", () => {
      const state = { game: {} };
      const deltas: StateDeltaOp[] = [
        { 
          op: "merge", 
          path: "game.settings", 
          value: { difficulty: "hard", music: true } 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.settings.difficulty).toBe("hard");
      expect(result.newState.game.settings.music).toBe(true);
    });

    it("should fail if path is not an object", () => {
      const state = { game: { phase: "playing" } };
      const deltas: StateDeltaOp[] = [
        { 
          op: "merge", 
          path: "game.phase", 
          value: { test: "value" } 
        },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(false);
      expect(result.errors![0].error).toContain("not an object");
    });
  });

  describe("sequential operations", () => {
    it("should apply multiple operations in sequence", () => {
      const state = { 
        game: { 
          phase: "setup", 
          round: 0 
        },
        players: { 
          p1: { score: 0 }, 
          p2: { score: 0 } 
        } 
      };

      const deltas: StateDeltaOp[] = [
        { op: "set", path: "game.phase", value: "playing" },
        { op: "increment", path: "game.round", value: 1 },
        { op: "set", path: "players.p1.score", value: 10 },
        { op: "set", path: "players.p2.score", value: 5 },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.phase).toBe("playing");
      expect(result.newState.game.round).toBe(1);
      expect(result.newState.players.p1.score).toBe(10);
      expect(result.newState.players.p2.score).toBe(5);
    });

    it("should allow operations to build on previous operations", () => {
      const state = { game: { history: [] } };

      const deltas: StateDeltaOp[] = [
        { op: "append", path: "game.history", value: "event1" },
        { op: "append", path: "game.history", value: "event2" },
        { op: "append", path: "game.history", value: "event3" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.history).toEqual(["event1", "event2", "event3"]);
    });

    it("should stop on first error but return partial state", () => {
      const state = { 
        game: { round: 1, phase: "playing" } 
      };

      const deltas: StateDeltaOp[] = [
        { op: "increment", path: "game.round", value: 1 },
        { op: "increment", path: "game.phase", value: 1 }, // This will fail
        { op: "set", path: "game.finished", value: true },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.newState.game.round).toBe(2); // First op succeeded
      expect(result.newState.game.finished).toBe(true); // Third op still executed
    });
  });

  describe("validation", () => {
    it("should validate correct delta schemas", () => {
      const deltas = [
        { op: "set", path: "game.phase", value: "playing" },
        { op: "increment", path: "game.round", value: 1 },
      ];

      const result = validateStateDeltas(deltas);

      expect(result.valid).toBe(true);
      expect(result.parsed).toHaveLength(2);
    });

    it("should reject invalid operation types", () => {
      const deltas = [
        { op: "invalid_op", path: "game.phase", value: "playing" },
      ];

      const result = validateStateDeltas(deltas);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should reject operations missing required fields", () => {
      const deltas = [
        { op: "set", value: "playing" }, // Missing 'path'
      ];

      const result = validateStateDeltas(deltas);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("should validate within applyStateDeltas", () => {
      const state = { game: { phase: "setup" } };
      const invalidDeltas: any = [
        { op: "invalid", path: "test" },
      ];

      const result = applyStateDeltas(state, invalidDeltas);

      expect(result.success).toBe(false);
      expect(result.errors![0].error).toContain("validation failed");
    });
  });

  describe("immutability", () => {
    it("should not mutate the original state", () => {
      const state = { 
        game: { phase: "setup", round: 0 },
        players: { p1: { score: 0 } }
      };
      const originalState = JSON.parse(JSON.stringify(state));

      const deltas: StateDeltaOp[] = [
        { op: "set", path: "game.phase", value: "playing" },
        { op: "increment", path: "game.round", value: 1 },
        { op: "set", path: "players.p1.score", value: 10 },
      ];

      applyStateDeltas(state, deltas);

      expect(state).toEqual(originalState);
    });
  });

  describe("complex game state example", () => {
    it("should handle a realistic RPS round transition", () => {
      const state = {
        game: {
          phase: "scoring",
          currentRound: 2,
          totalRounds: 3,
          history: [
            { round: 1, winner: "p1" },
          ],
        },
        players: {
          p1: { 
            totalScore: 1, 
            submittedMove: true, 
            currentMove: "rock" 
          },
          p2: { 
            totalScore: 0, 
            submittedMove: true, 
            currentMove: "scissors" 
          },
        },
      };

      // Simulate scoring and moving to next round
      const deltas: StateDeltaOp[] = [
        // Award point to p1
        { op: "increment", path: "players.p1.totalScore", value: 1 },
        // Record round result
        { 
          op: "append", 
          path: "game.history", 
          value: { round: 2, winner: "p1" } 
        },
        // Clear submitted moves
        { op: "set", path: "players.p1.submittedMove", value: false },
        { op: "set", path: "players.p2.submittedMove", value: false },
        { op: "delete", path: "players.p1.currentMove" },
        { op: "delete", path: "players.p2.currentMove" },
        // Advance round
        { op: "increment", path: "game.currentRound", value: 1 },
        { op: "set", path: "game.phase", value: "playing" },
      ];

      const result = applyStateDeltas(state, deltas);

      expect(result.success).toBe(true);
      expect(result.newState.game.phase).toBe("playing");
      expect(result.newState.game.currentRound).toBe(3);
      expect(result.newState.players.p1.totalScore).toBe(2);
      expect(result.newState.game.history).toHaveLength(2);
      expect(result.newState.players.p1.submittedMove).toBe(false);
      expect(result.newState.players.p1.currentMove).toBeUndefined();
    });
  });
});

describe("Template Resolution", () => {
  describe("hasTemplateVariables", () => {
    it("should detect template variables in strings", () => {
      expect(hasTemplateVariables("players.{{playerId}}.score")).toBe(true);
      expect(hasTemplateVariables("players.p1.score")).toBe(false);
      expect(hasTemplateVariables("{{var}}")).toBe(true);
    });

    it("should detect template variables in objects", () => {
      expect(hasTemplateVariables({ path: "players.{{id}}.score" })).toBe(true);
      expect(hasTemplateVariables({ path: "players.p1.score" })).toBe(false);
    });

    it("should handle null/undefined", () => {
      expect(hasTemplateVariables(null)).toBe(false);
      expect(hasTemplateVariables(undefined)).toBe(false);
    });
  });

  describe("extractTemplateVariables", () => {
    it("should extract variable names from strings", () => {
      expect(extractTemplateVariables("players.{{playerId}}.score")).toEqual(["playerId"]);
      expect(extractTemplateVariables("{{a}}.{{b}}.{{c}}")).toEqual(["a", "b", "c"]);
    });

    it("should extract unique variables only", () => {
      expect(extractTemplateVariables("{{var}}.{{var}}.{{var}}")).toEqual(["var"]);
    });

    it("should extract from objects", () => {
      const obj = {
        path: "players.{{playerId}}.{{field}}",
        value: "{{value}}"
      };
      const vars = extractTemplateVariables(obj);
      expect(vars.sort()).toEqual(["field", "playerId", "value"].sort());
    });

    it("should handle no variables", () => {
      expect(extractTemplateVariables("no variables here")).toEqual([]);
    });
  });

  describe("resolveTemplates", () => {
    it("should resolve simple string templates", () => {
      const result = resolveTemplates(
        "players.{{playerId}}.score",
        { playerId: "p1" }
      );
      expect(result).toBe("players.p1.score");
    });

    it("should resolve multiple variables in one string", () => {
      const result = resolveTemplates(
        "{{player}} played {{move}}",
        { player: "Alice", move: "rock" }
      );
      expect(result).toBe("Alice played rock");
    });

    it("should preserve type for whole-value templates", () => {
      const result = resolveTemplates("{{value}}", { value: 42 });
      expect(result).toBe(42);
      expect(typeof result).toBe("number");
    });

    it("should resolve object templates", () => {
      const template = {
        path: "players.{{id}}.score",
        value: "{{points}}"
      };
      const result = resolveTemplates(template, { id: "p1", points: 10 });
      expect(result).toEqual({
        path: "players.p1.score",
        value: 10
      });
    });

    it("should resolve nested object templates", () => {
      const template = {
        winner: "{{winnerId}}",
        moves: {
          p1: "{{p1Move}}",
          p2: "{{p2Move}}"
        }
      };
      const result = resolveTemplates(template, {
        winnerId: "p1",
        p1Move: "rock",
        p2Move: "scissors"
      });
      expect(result).toEqual({
        winner: "p1",
        moves: {
          p1: "rock",
          p2: "scissors"
        }
      });
    });

    it("should keep unresolved variables as-is", () => {
      const result = resolveTemplates(
        "players.{{playerId}}.{{unknownVar}}",
        { playerId: "p1" }
      );
      expect(result).toBe("players.p1.{{unknownVar}}");
    });

    it("should handle whitespace in variable names", () => {
      const result = resolveTemplates(
        "players.{{ playerId }}.score",
        { playerId: "p1" }
      );
      expect(result).toBe("players.p1.score");
    });
  });

  describe("resolveStateDeltaTemplates", () => {
    it("should resolve templates in delta operations", () => {
      const templates: StateDeltaOp[] = [
        { 
          op: "set", 
          path: "players.{{playerId}}.currentMove", 
          value: "{{move}}" 
        },
        { 
          op: "increment", 
          path: "players.{{playerId}}.score", 
          value: 1 
        }
      ];

      const resolved = resolveStateDeltaTemplates(templates, {
        playerId: "p1",
        move: "rock"
      });

      expect(resolved).toEqual([
        { op: "set", path: "players.p1.currentMove", value: "rock" },
        { op: "increment", path: "players.p1.score", value: 1 }
      ]);
    });

    it("should resolve complex append operations", () => {
      const templates: StateDeltaOp[] = [
        {
          op: "append",
          path: "game.history",
          value: {
            round: "{{roundNum}}",
            winner: "{{winnerId}}",
            p1Move: "{{p1Move}}",
            p2Move: "{{p2Move}}"
          }
        }
      ];

      const resolved = resolveStateDeltaTemplates(templates, {
        roundNum: 2,
        winnerId: "p1",
        p1Move: "rock",
        p2Move: "scissors"
      });

      expect(resolved[0]).toEqual({
        op: "append",
        path: "game.history",
        value: {
          round: 2,
          winner: "p1",
          p1Move: "rock",
          p2Move: "scissors"
        }
      });
    });

    it("should work with player action templates", () => {
      const templates: StateDeltaOp[] = [
        { op: "set", path: "players.{{playerId}}.currentMove", value: "{{playerAction}}" },
        { op: "set", path: "players.{{playerId}}.submittedMove", value: true }
      ];

      const resolved = resolveStateDeltaTemplates(templates, {
        playerId: "p2",
        playerAction: "paper"
      });

      expect(resolved).toEqual([
        { op: "set", path: "players.p2.currentMove", value: "paper" },
        { op: "set", path: "players.p2.submittedMove", value: true }
      ]);
    });
  });
});
