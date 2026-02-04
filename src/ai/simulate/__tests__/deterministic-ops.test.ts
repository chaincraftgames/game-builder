/**
 * Tests for Deterministic Operations
 * 
 * Validates deterministic operation detection and expansion functionality.
 */

import { describe, expect, it } from "@jest/globals";
import {
  isDeterministicOperation,
  expandAndTransformOperation,
} from "../deterministic-ops.js";
import { StateDeltaOp } from "../logic/statedelta.js";
import { PlayerMapping } from "../player-mapping.js";

describe("Deterministic Operations", () => {
  describe("isDeterministicOperation", () => {
    it("should recognize setForAllPlayers as deterministic with literal values", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "score",
        value: 0,
      };

      expect(isDeterministicOperation(op)).toBe(true);
    });

    it("should recognize setForAllPlayers with boolean values as deterministic", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "actionRequired",
        value: true,
      };

      expect(isDeterministicOperation(op)).toBe(true);
    });

    it("should recognize setForAllPlayers with null values as deterministic", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "currentChoice",
        value: null,
      };

      expect(isDeterministicOperation(op)).toBe(true);
    });

    it("should reject setForAllPlayers with template in field", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "{{fieldName}}",
        value: 0,
      };

      expect(isDeterministicOperation(op)).toBe(false);
    });

    it("should reject setForAllPlayers with template in value", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "score",
        value: "{{initialScore}}",
      };

      expect(isDeterministicOperation(op)).toBe(false);
    });
  });

  describe("expandAndTransformOperation", () => {
    it("should expand setForAllPlayers to individual set operations", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "score",
        value: 0,
      };

      const mapping: PlayerMapping = {
        player1: "uuid-123",
        player2: "uuid-456",
      };

      const expanded = expandAndTransformOperation(op, mapping);

      expect(expanded).toHaveLength(2);
      expect(expanded).toEqual([
        { op: "set", path: "players.uuid-123.score", value: 0 },
        { op: "set", path: "players.uuid-456.score", value: 0 },
      ]);
    });

    it("should expand setForAllPlayers with boolean value", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "actionRequired",
        value: true,
      };

      const mapping: PlayerMapping = {
        player1: "uuid-abc",
        player2: "uuid-def",
        player3: "uuid-ghi",
      };

      const expanded = expandAndTransformOperation(op, mapping);

      expect(expanded).toHaveLength(3);
      expect(expanded).toEqual([
        { op: "set", path: "players.uuid-abc.actionRequired", value: true },
        { op: "set", path: "players.uuid-def.actionRequired", value: true },
        { op: "set", path: "players.uuid-ghi.actionRequired", value: true },
      ]);
    });

    it("should expand setForAllPlayers with null value", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "currentChoice",
        value: null,
      };

      const mapping: PlayerMapping = {
        player1: "uuid-p1",
        player2: "uuid-p2",
      };

      const expanded = expandAndTransformOperation(op, mapping);

      expect(expanded).toHaveLength(2);
      expect(expanded).toEqual([
        { op: "set", path: "players.uuid-p1.currentChoice", value: null },
        { op: "set", path: "players.uuid-p2.currentChoice", value: null },
      ]);
    });

    it("should handle nested field paths in setForAllPlayers", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "stats.wins",
        value: 0,
      };

      const mapping: PlayerMapping = {
        player1: "uuid-1",
        player2: "uuid-2",
      };

      const expanded = expandAndTransformOperation(op, mapping);

      expect(expanded).toHaveLength(2);
      expect(expanded).toEqual([
        { op: "set", path: "players.uuid-1.stats.wins", value: 0 },
        { op: "set", path: "players.uuid-2.stats.wins", value: 0 },
      ]);
    });

    it("should return empty array when no players in mapping", () => {
      const op: StateDeltaOp = {
        op: "setForAllPlayers",
        field: "score",
        value: 0,
      };

      const mapping: PlayerMapping = {};

      const expanded = expandAndTransformOperation(op, mapping);

      expect(expanded).toHaveLength(0);
    });
  });
});
