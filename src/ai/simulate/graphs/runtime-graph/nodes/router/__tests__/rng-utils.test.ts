/**
 * Tests for RNG utilities
 */

import { processRngInstructions } from '../rng-utils.js';

describe('RNG Utils', () => {
  describe('processRngInstructions', () => {
    it('should return instructions unchanged if no stateDelta', () => {
      const instructions = {
        phase: 'test',
        messages: { public: { to: 'all', template: 'test' } }
      };

      const result = processRngInstructions(instructions);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(instructions);
    });

    it('should return instructions unchanged if no RNG operations in stateDelta', () => {
      const instructions = {
        phase: 'test',
        stateDelta: [
          { op: 'set', path: 'game.value', value: 'fixed' },
          { op: 'increment', path: 'game.counter', value: 1 }
        ]
      };

      const result = processRngInstructions(instructions);
      const parsed = JSON.parse(result);

      expect(parsed).toEqual(instructions);
    });

    it('should convert RNG operation to set operation with seeded randomness', () => {
      const instructions = {
        phase: 'init',
        stateDelta: [
          { 
            op: 'rng',
            path: 'game.oracleMood',
            choices: ['calm', 'irritable', 'cryptic'],
            probabilities: [0.33, 0.33, 0.34]
          }
        ]
      };

      // Use seed for deterministic result
      const result = processRngInstructions(instructions, 12345);
      const parsed = JSON.parse(result);

      // RNG op should be converted to set op
      expect(parsed.stateDelta[0].op).toBe('set');
      expect(parsed.stateDelta[0].path).toBe('game.oracleMood');
      expect(['calm', 'irritable', 'cryptic']).toContain(parsed.stateDelta[0].value);
      
      // Should not have choices/probabilities anymore
      expect(parsed.stateDelta[0].choices).toBeUndefined();
      expect(parsed.stateDelta[0].probabilities).toBeUndefined();
    });

    it('should handle multiple RNG operations', () => {
      const instructions = {
        phase: 'event',
        stateDelta: [
          { op: 'set', path: 'game.round', value: 1 },
          { 
            op: 'rng',
            path: 'game.special',
            choices: [true, false],
            probabilities: [0.05, 0.95]
          },
          { 
            op: 'rng',
            path: 'game.event',
            choices: ['good', 'neutral', 'bad'],
            probabilities: [0.3, 0.5, 0.2]
          }
        ]
      };

      const result = processRngInstructions(instructions, 42);
      const parsed = JSON.parse(result);

      // First op unchanged (not RNG)
      expect(parsed.stateDelta[0]).toEqual({ op: 'set', path: 'game.round', value: 1 });
      
      // RNG ops converted to set ops
      expect(parsed.stateDelta[1].op).toBe('set');
      expect(parsed.stateDelta[1].path).toBe('game.special');
      expect([true, false]).toContain(parsed.stateDelta[1].value);
      
      expect(parsed.stateDelta[2].op).toBe('set');
      expect(parsed.stateDelta[2].path).toBe('game.event');
      expect(['good', 'neutral', 'bad']).toContain(parsed.stateDelta[2].value);
    });

    it('should produce consistent results with same seed', () => {
      const instructions = {
        stateDelta: [
          { 
            op: 'rng',
            path: 'value',
            choices: ['a', 'b', 'c'],
            probabilities: [0.33, 0.33, 0.34]
          }
        ]
      };

      const result1 = processRngInstructions(instructions, 999);
      const result2 = processRngInstructions(instructions, 999);

      expect(result1).toBe(result2);
    });

    it('should handle string input', () => {
      const instructions = JSON.stringify({
        stateDelta: [
          { 
            op: 'rng',
            path: 'value',
            choices: ['yes', 'no'],
            probabilities: [0.5, 0.5]
          }
        ]
      });

      const result = processRngInstructions(instructions, 100);
      const parsed = JSON.parse(result);

      expect(parsed.stateDelta[0].op).toBe('set');
      expect(['yes', 'no']).toContain(parsed.stateDelta[0].value);
    });

    it('should warn if probabilities do not sum to 1.0', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const instructions = {
        stateDelta: [
          { 
            op: 'rng',
            path: 'game.bad',
            choices: ['a', 'b'],
            probabilities: [0.3, 0.3] // Only sums to 0.6
          }
        ]
      };

      processRngInstructions(instructions);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Probabilities for game.bad sum to 0.6')
      );
      
      consoleWarnSpy.mockRestore();
    });

    it('should handle non-string choices (boolean, number)', () => {
      const instructions = {
        stateDelta: [
          { 
            op: 'rng',
            path: 'game.activated',
            choices: [true, false],
            probabilities: [0.1, 0.9]
          },
          { 
            op: 'rng',
            path: 'game.diceRoll',
            choices: [1, 2, 3, 4, 5, 6],
            probabilities: [0.16, 0.17, 0.17, 0.17, 0.17, 0.16]
          }
        ]
      };

      const result = processRngInstructions(instructions, 777);
      const parsed = JSON.parse(result);

      // Boolean choice
      expect(typeof parsed.stateDelta[0].value).toBe('boolean');
      
      // Number choice
      expect(typeof parsed.stateDelta[1].value).toBe('number');
      expect(parsed.stateDelta[1].value).toBeGreaterThanOrEqual(1);
      expect(parsed.stateDelta[1].value).toBeLessThanOrEqual(6);
    });
  });
});
