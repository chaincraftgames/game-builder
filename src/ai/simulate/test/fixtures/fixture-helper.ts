/**
 * Fixture Test Helper
 * 
 * Provides convenient methods for working with test fixtures in a way that
 * adapts to fixture changes via the mapping system.
 */

import { GameFieldMapping, getPlayerField, getGameField } from "./fixture-mappings.js";

export class FixtureHelper {
  constructor(
    private fixture: any,
    private mapping: GameFieldMapping
  ) {}

  /**
   * Get the initial game phase (usually "init")
   */
  getInitPhase(): string {
    return this.mapping.phases.init;
  }

  /**
   * Get the first active gameplay phase (after init)
   */
  getFirstActivePhase(): string {
    return this.mapping.phases.firstActive;
  }

  /**
   * Get the resolution/scoring phase (if applicable)
   */
  getResolvePhase(): string | undefined {
    return this.mapping.phases.resolve;
  }

  /**
   * Get the final/end game phase
   */
  getFinalPhase(): string {
    return this.mapping.phases.final;
  }

  /**
   * Get a transition by its mapped ID
   */
  getTransition(transitionKey: keyof GameFieldMapping["transitions"]) {
    const transitionId = this.mapping.transitions[transitionKey];
    if (!transitionId) {
      throw new Error(`Transition ${transitionKey} not mapped`);
    }
    return this.fixture.transitions.transitions[transitionId];
  }

  /**
   * Get instructions for a transition
   */
  getTransitionInstructions(transitionKey: keyof GameFieldMapping["transitions"]) {
    const transitionId = this.mapping.transitions[transitionKey];
    if (!transitionId) {
      throw new Error(`Transition ${transitionKey} not mapped`);
    }
    return this.fixture.instructions.transitions[transitionId];
  }

  /**
   * Get the destination phase for a transition
   */
  getTransitionDestination(transitionKey: keyof GameFieldMapping["transitions"]): string {
    const transition = this.getTransition(transitionKey);
    return transition.to;
  }

  /**
   * Get player field value using mapping
   */
  getPlayerField(
    playerState: any,
    field: keyof GameFieldMapping["player"]
  ): any {
    return getPlayerField(playerState, field, this.mapping);
  }

  /**
   * Get game field value using mapping
   */
  getGameField(
    gameState: any,
    field: keyof GameFieldMapping["game"]
  ): any {
    return getGameField(gameState, field, this.mapping);
  }

  /**
   * Set player field value using mapping
   */
  setPlayerField(
    playerState: any,
    field: keyof GameFieldMapping["player"],
    value: any
  ): void {
    const fieldName = this.mapping.player[field];
    if (!fieldName) {
      throw new Error(`Field ${field} not mapped`);
    }
    playerState[fieldName] = value;
  }

  /**
   * Set game field value using mapping
   */
  setGameField(
    gameState: any,
    field: keyof GameFieldMapping["game"],
    value: any
  ): void {
    const fieldName = this.mapping.game[field];
    if (!fieldName) {
      throw new Error(`Field ${field} not mapped`);
    }
    gameState[fieldName] = value;
  }

  /**
   * Create a basic game state structure
   */
  createGameState(overrides: {
    phase?: string;
    gameEnded?: boolean;
    [key: string]: any;
  } = {}): any {
    return {
      game: {
        currentPhase: overrides.phase || this.getInitPhase(),
        gameEnded: overrides.gameEnded ?? false,
        publicMessage: "",
        ...overrides,
      },
      players: {},
    };
  }

  /**
   * Create a player state structure
   */
  createPlayerState(overrides: {
    score?: number;
    choice?: any;
    [key: string]: any;
  } = {}): any {
    const playerState: any = {
      illegalActionCount: 0,
      // actionsAllowed omitted - will default to actionRequired
      actionRequired: false,
    };

    // Set mapped fields if provided
    if (overrides.score !== undefined) {
      this.setPlayerField(playerState, "score", overrides.score);
    }
    if (overrides.choice !== undefined) {
      this.setPlayerField(playerState, "choice", overrides.choice);
    }

    // Apply other overrides
    Object.entries(overrides).forEach(([key, value]) => {
      if (key !== "score" && key !== "choice") {
        playerState[key] = value;
      }
    });

    return playerState;
  }

  /**
   * Get all phase names in order
   */
  getAllPhases(): string[] {
    return this.fixture.transitions.phases;
  }

  /**
   * Get schema
   */
  getSchema() {
    return this.fixture.schema;
  }

  /**
   * Get schema as stringified JSON (for RuntimeStateType)
   */
  getStateSchemaString(): string {
    return JSON.stringify(this.fixture.schema);
  }

  /**
   * Get initial state
   */
  getInitialState() {
    return this.fixture.initialState;
  }
}
