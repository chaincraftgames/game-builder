/**
 * Integration Test for Extract Instructions Node
 * 
 * Validates the complete two-phase process:
 * 1. Planner identifies what instructions are needed (hints)
 * 2. Executor generates concrete templated instructions
 */

import { describe, expect, it } from "@jest/globals";
import { setupSpecInstructionsModel } from "#chaincraft/ai/model-config.js";
import { extractInstructions } from "../index.js";
import { InstructionsArtifact } from "#chaincraft/ai/simulate/schema.js";
import { JsonLogicSchema } from "#chaincraft/ai/simulate/logic/jsonlogic.js";
import jsonLogic from "json-logic-js";

describe("Extract Instructions Node", () => {
  it("should generate complete instructions artifact for RPS game", async () => {
    const gameSpecification = `
Rock Paper Scissors is a game for 2 players that runs for 3 rounds.

SETUP:
- Game starts in "choice" phase
- Both players have score of 0

GAMEPLAY (Choice Phase):
- Each player secretly submits their choice: rock, paper, or scissors
- Once both players have submitted, game automatically transitions to reveal

SCORING (Reveal Phase):
- Choices are revealed to all players
- Winner is determined using RPS rules:
  * Rock beats scissors
  * Scissors beats paper
  * Paper beats rock
  * Same choice = tie (no score change)
- Winner gets 1 point added to score
- If round < 3, game transitions back to choice phase for next round
- If round = 3, game transitions to finished phase

FINISHED:
- Game ends
- Player with highest score wins
`;

    const stateSchema = JSON.stringify({
      type: "object",
      properties: {
        game: {
          type: "object",
          description: "Core game state",
          properties: {
            phase: { type: "string", description: "Current phase: choice, reveal, or finished" },
            round: { type: "number", description: "Current round (1-3)" },
            gameEnded: { type: "boolean", description: "Whether game has ended" },
            publicMessage: { type: "string", description: "Public message to all players" }
          },
          required: ["phase", "round", "gameEnded"]
        },
        players: {
          type: "object",
          description: "Player state keyed by player ID",
          additionalProperties: {
            type: "object",
            properties: {
              name: { type: "string", description: "Player name" },
              choice: { type: ["string", "null"], description: "Player's choice (rock/paper/scissors)" },
              score: { type: "number", description: "Player's current score" },
              actionRequired: { type: "boolean", description: "Whether player action is required" },
              illegalActionCount: { type: "number", description: "Count of illegal actions" },
              privateMessage: { type: "string", description: "Private message to player" }
            },
            required: ["score", "actionRequired", "illegalActionCount"]
          }
        }
      },
      required: ["game", "players"]
    });

    const transitionsArtifact = JSON.stringify({
      phases: ["choice", "reveal", "finished"],
      phaseMetadata: [
        { phase: "choice", requiresPlayerInput: true },
        { phase: "reveal", requiresPlayerInput: false },
        { phase: "finished", requiresPlayerInput: false }
      ],
      transitions: [
        {
          id: "choices-complete",
          fromPhase: "choice",
          toPhase: "reveal",
          condition: "Both players have submitted choices",
          checkedFields: ["players.p1.choice", "players.p2.choice"],
          preconditions: [
            {
              id: "both-submitted",
              logic: { "and": [
                { "!=": [{ "var": "players.p1.choice" }, null] },
                { "!=": [{ "var": "players.p2.choice" }, null] }
              ]},
              deterministic: true,
              explain: "Both players have submitted their choices"
            }
          ],
          humanSummary: "Move to reveal when both players submitted"
        },
        {
          id: "continue-game",
          fromPhase: "reveal",
          toPhase: "choice",
          condition: "Round < 3",
          checkedFields: ["game.round"],
          preconditions: [
            {
              id: "more-rounds",
              logic: { "<": [{ "var": "game.round" }, 3] },
              deterministic: true,
              explain: "Game has more rounds to play"
            }
          ],
          humanSummary: "Start next round if game not complete"
        },
        {
          id: "end-game",
          fromPhase: "reveal",
          toPhase: "finished",
          condition: "Round = 3",
          checkedFields: ["game.round"],
          preconditions: [
            {
              id: "final-round",
              logic: { "==": [{ "var": "game.round" }, 3] },
              deterministic: true,
              explain: "Game has reached final round"
            }
          ],
          humanSummary: "End game after 3 rounds"
        }
      ]
    });

    // Setup model and execute node
    const model = await setupSpecInstructionsModel();
    const node = extractInstructions(model);
    
    // Create mock state
    const inputState = {
      gameSpecification,
      stateSchema,
      stateTransitions: transitionsArtifact,
      gameRules: "",
      phaseInstructions: {},
      exampleState: "",
      playerPhaseInstructions: {},
      transitionInstructions: {},
    };
    
    // Execute node
    console.log("\n=== Executing Extract Instructions Node ===\n");
    const result = await node(inputState);
    
    // Parse result - separated into playerPhaseInstructions and transitionInstructions
    expect(result.playerPhaseInstructions).toBeDefined();
    expect(result.transitionInstructions).toBeDefined();
    const playerPhaseInstructionsMap = result.playerPhaseInstructions!;
    const transitionInstructionsMap = result.transitionInstructions!;
    expect(Object.keys(playerPhaseInstructionsMap).length).toBeGreaterThan(0);
    expect(Object.keys(transitionInstructionsMap).length).toBeGreaterThan(0);
    
    // Parse instructions from separated maps
    const parsedPlayerPhases: Record<string, any> = {};
    const parsedTransitions: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(playerPhaseInstructionsMap)) {
      parsedPlayerPhases[key] = JSON.parse(value);
    }
    
    for (const [key, value] of Object.entries(transitionInstructionsMap)) {
      parsedTransitions[key] = JSON.parse(value);
    }
    
    const instructions: InstructionsArtifact = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      playerPhases: parsedPlayerPhases,
      transitions: parsedTransitions,
      metadata: {
        totalPlayerPhases: Object.keys(parsedPlayerPhases).length,
        totalTransitions: Object.keys(parsedTransitions).length,
        deterministicInstructionCount: 0, // Would need to analyze instructions to count
        llmDrivenInstructionCount: 0, // Would need to analyze instructions to count
      }
    };
    
    // Save output for debugging
    const fs = await import('fs');
    await fs.promises.writeFile(
      '/tmp/instructions-output.json',
      JSON.stringify(instructions, null, 2),
      'utf-8'
    );
    console.log("Saved full output to /tmp/instructions-output.json");
    
    console.log("\n=== Instructions Artifact ===");
    console.log(`Version: ${instructions.version}`);
    console.log(`Player Phases: ${Object.keys(parsedPlayerPhases).join(", ")}`);
    console.log(`Transitions: ${Object.keys(parsedTransitions).join(", ")}`);
    console.log(`Total Player Phases: ${instructions.metadata.totalPlayerPhases}`);
    console.log(`Total Transitions: ${instructions.metadata.totalTransitions}`);
    console.log(`Deterministic Instructions: ${instructions.metadata.deterministicInstructionCount}`);
    console.log(`LLM-Driven Instructions: ${instructions.metadata.llmDrivenInstructionCount}`);
    console.log("\n=== Validation ===");

    // Validate artifact structure
    expect(instructions).toBeDefined();
    expect(instructions.version).toBeDefined();
    expect(instructions.generatedAt).toBeDefined();
    console.log(`✓ Artifact has version ${instructions.version}`);

    // Validate player phases (only phases requiring player input)
    expect(typeof instructions.playerPhases).toBe('object');
    expect(Object.keys(instructions.playerPhases)).toContain("choice");
    // Note: reveal and finished phases won't be here - they don't require player input
    console.log(`✓ Player Phases: ${Object.keys(instructions.playerPhases).join(", ")}`);

    // Validate instructions coverage
    expect(typeof instructions.playerPhases).toBe('object');
    expect(typeof instructions.transitions).toBe('object');
    
    const playerPhases = instructions.playerPhases;

    // Choice phase should have player actions
    const choicePhase = playerPhases["choice"];
    expect(choicePhase).toBeDefined();
    expect(Array.isArray(choicePhase.playerActions)).toBe(true);
    expect(choicePhase.playerActions.length).toBeGreaterThan(0);
    
    // Find submit choice action
    const submitAction = choicePhase.playerActions.find(
      (a: any) => a.actionName.toLowerCase().includes("choice") || a.actionName.toLowerCase().includes("submit")
    );
    expect(submitAction).toBeDefined();
    expect(submitAction?.id).toBeDefined();
    
    // Validate action has proper validation structure
    if (submitAction?.validation) {
      expect(submitAction.validation.checks).toBeDefined();
      expect(Array.isArray(submitAction.validation.checks)).toBe(true);
      expect(submitAction.validation.checks.length).toBeGreaterThan(0);
      
      // Check validation structure (new format)
      const firstCheck = submitAction.validation.checks[0];
      expect(firstCheck.id).toBeDefined();
      expect(firstCheck.logic).toBeDefined();
      expect(firstCheck.errorMessage).toBeDefined();
      console.log(`✓ Submit action has ${submitAction.validation.checks.length} validation checks with explicit error messages`);
    }
    
    // Validate action has stateDelta operations
    expect(Array.isArray(submitAction?.stateDelta)).toBe(true);
    expect(submitAction?.stateDelta.length).toBeGreaterThan(0);
    
    const firstOp = submitAction!.stateDelta[0];
    expect(firstOp.op).toBeDefined();
    if ('path' in firstOp) {
      expect(firstOp.path).toBeDefined();
    }
    console.log(`✓ Submit action has ${submitAction!.stateDelta.length} stateDelta operations (first op: ${firstOp.op})`);

    // Should have transitions (all automatic transitions are in transitions map)
    const transitionsMap = instructions.transitions;
    expect(Object.keys(transitionsMap).length).toBeGreaterThan(0);
    
    // Find a transition that handles game logic (likely from reveal phase)
    const resolveTransition = Object.values(transitionsMap).find((t: any) => 
      t.id && t.stateDelta && t.mechanicsGuidance
    );
    expect(resolveTransition).toBeDefined();
    
    // Router handles transition selection via preconditions in stateTransitions
    // Instructions only need stateDelta and mechanicsGuidance
    
    // Critical: Should have mechanics guidance for RPS rules
    if (resolveTransition?.mechanicsGuidance) {
      expect(resolveTransition.mechanicsGuidance.rules).toBeDefined();
      expect(Array.isArray(resolveTransition.mechanicsGuidance.rules)).toBe(true);
      expect(resolveTransition.mechanicsGuidance.rules.length).toBeGreaterThan(0);
      
      const rulesText = resolveTransition.mechanicsGuidance.rules.join(" ").toLowerCase();
      expect(rulesText).toMatch(/rock.*scissors|scissors.*rock/);
      expect(rulesText).toMatch(/scissors.*paper|paper.*scissors/);
      expect(rulesText).toMatch(/paper.*rock|rock.*paper/);
      console.log(`✓ Resolve transition has RPS mechanics: ${resolveTransition.mechanicsGuidance.rules.length} rules`);
    }
    
    // Should have stateDelta operations
    expect(Array.isArray(resolveTransition?.stateDelta)).toBe(true);
    expect(resolveTransition?.stateDelta.length).toBeGreaterThan(0);
    console.log(`✓ Resolve transition has ${resolveTransition!.stateDelta.length} stateDelta operations`);
    
    // Should have messaging
    if (resolveTransition?.messages) {
      expect(resolveTransition.messages.public || resolveTransition.messages.private).toBeDefined();
      console.log(`✓ Resolve transition includes messaging`);
    }

    // Finished phase is NOT in playerPhases (doesn't require player input)
    // It would only have transitions in the transitions map
    expect(playerPhases["finished"]).toBeUndefined();
    console.log(`✓ Finished phase not in playerPhases (doesn't require player input)`);

    // Validate metadata accuracy
    const actualPlayerPhases = Object.keys(instructions.playerPhases).length;
    const actualTransitions = Object.keys(instructions.transitions).length;
    expect(instructions.metadata.totalPlayerPhases).toBe(actualPlayerPhases);
    expect(instructions.metadata.totalTransitions).toBe(actualTransitions);
    expect(actualPlayerPhases).toBeGreaterThan(0);
    expect(actualTransitions).toBeGreaterThan(0);
    console.log(`✓ Metadata matches actual counts (${actualPlayerPhases} player phases, ${actualTransitions} transitions)`);

    // ========================================================================
    // COMPREHENSIVE VALIDATION
    // ========================================================================
    
    console.log("\n=== Comprehensive Validation ===");
    
    // 1. JSONLOGIC VALIDATION
    console.log("\n--- JsonLogic Validation ---");
    let jsonLogicCount = 0;
    let jsonLogicErrors: string[] = [];
    
    // Validate player action preconditions
    for (const [phaseName, phaseInst] of Object.entries(instructions.playerPhases)) {
      for (const action of phaseInst.playerActions) {
        if (action.validation?.checks) {
          for (const check of action.validation.checks) {
            jsonLogicCount++;
            
            // Validate JsonLogic is parseable
            const parseResult = JsonLogicSchema.safeParse(check.logic);
            if (!parseResult.success) {
              jsonLogicErrors.push(
                `Action ${action.id} check ${check.id}: Invalid JsonLogic - ${parseResult.error.message}`
              );
            }
            
            // Try to evaluate against mock data (should not throw)
            try {
              const mockData = {
                game: { phase: "choice", round: 1 },
                players: { p1: { choice: null }, testPlayer: { choice: null } },
                input: { choice: "rock" }
              };
              jsonLogic.apply(check.logic, mockData);
            } catch (e) {
              jsonLogicErrors.push(
                `Action ${action.id} check ${check.id}: JsonLogic evaluation failed - ${e}`
              );
            }
          }
        }
      }
    }
    
    // Validate automatic transition preconditions
    // Router handles preconditions via stateTransitions artifact
    // Instructions don't need trigger.preconditions anymore
    for (const [transitionId, transition] of Object.entries(instructions.transitions)) {
      // Validation disabled - trigger.preconditions removed from schema
    }
    
    if (jsonLogicErrors.length > 0) {
      console.error("JsonLogic validation errors:", jsonLogicErrors);
      throw new Error(`Found ${jsonLogicErrors.length} JsonLogic errors`);
    }
    console.log(`✓ All ${jsonLogicCount} JsonLogic expressions are valid and executable`);
    
    // 2. STATEDELTA VALIDATION
    console.log("\n--- StateDelta Validation ---");
    let stateDeltaCount = 0;
    let stateDeltaErrors: string[] = [];
    
    const validateStateDeltaOp = (op: any, context: string) => {
      stateDeltaCount++;
      
      // All ops must have 'op' and 'path'
      if (!op.op) {
        stateDeltaErrors.push(`${context}: Missing 'op' field`);
        return;
      }
      if (!op.path) {
        stateDeltaErrors.push(`${context}: Missing 'path' field`);
        return;
      }
      
      // Validate type-specific required fields
      switch (op.op) {
        case "set":
          if (!("value" in op)) {
            stateDeltaErrors.push(`${context}: set op missing 'value' field`);
          }
          break;
        case "increment":
          if (!("value" in op)) {
            stateDeltaErrors.push(`${context}: increment op missing 'value' field`);
          }
          break;
        case "append":
          if (!("value" in op)) {
            stateDeltaErrors.push(`${context}: append op missing 'value' field`);
          }
          break;
        case "delete":
          // delete only needs op and path
          break;
        case "transfer":
          if (!op.fromPath) {
            stateDeltaErrors.push(`${context}: transfer op missing 'fromPath' field`);
          }
          if (!op.toPath) {
            stateDeltaErrors.push(`${context}: transfer op missing 'toPath' field`);
          }
          if (!("value" in op)) {
            stateDeltaErrors.push(`${context}: transfer op missing 'value' field`);
          }
          break;
        case "merge":
          if (!("value" in op)) {
            stateDeltaErrors.push(`${context}: merge op missing 'value' field`);
          }
          break;
        default:
          stateDeltaErrors.push(`${context}: Unknown op type '${op.op}'`);
      }
    };
    
    // Validate player actions
    for (const [phaseName, phaseInst] of Object.entries(instructions.playerPhases)) {
      for (const action of phaseInst.playerActions) {
        if (action.stateDelta) {
          for (let i = 0; i < action.stateDelta.length; i++) {
            validateStateDeltaOp(
              action.stateDelta[i], 
              `Action ${action.id} stateDelta[${i}]`
            );
          }
        }
      }
    }
    
    // Validate automatic transitions
    for (const [transitionId, transition] of Object.entries(instructions.transitions)) {
      for (let i = 0; i < transition.stateDelta.length; i++) {
        validateStateDeltaOp(
          transition.stateDelta[i], 
          `Transition ${transition.id} stateDelta[${i}]`
        );
      }
    }
    
    if (stateDeltaErrors.length > 0) {
      console.error("StateDelta validation errors:", stateDeltaErrors);
      throw new Error(`Found ${stateDeltaErrors.length} StateDelta errors`);
    }
    console.log(`✓ All ${stateDeltaCount} StateDelta operations are valid`);
    
    // 3. TEMPLATE VARIABLE VALIDATION
    console.log("\n--- Template Variable Validation ---");
    let templateCount = 0;
    let templateErrors: string[] = [];
    
    const validateTemplateString = (str: string, context: string) => {
      if (!str) return;
      
      // Find all {{variable}} patterns
      const templateMatches = str.match(/\{\{[^}]*\}\}/g);
      if (!templateMatches) return;
      
      for (const match of templateMatches) {
        templateCount++;
        
        // Check for proper closing
        if (!match.endsWith("}}")) {
          templateErrors.push(`${context}: Malformed template '${match}' - missing closing braces`);
          continue;
        }
        
        // Extract variable name
        const varName = match.slice(2, -2).trim();
        if (varName.length === 0) {
          templateErrors.push(`${context}: Empty template variable '{{}}'`);
        }
        
        // Check for nested braces (likely error)
        if (varName.includes("{{") || varName.includes("}}")) {
          templateErrors.push(`${context}: Nested template braces in '${match}'`);
        }
      }
    };
    
    // Validate player actions
    for (const [phaseName, phaseInst] of Object.entries(instructions.playerPhases)) {
      for (const action of phaseInst.playerActions) {
        // Check stateDelta paths and values
        for (const op of action.stateDelta) {
          if ('path' in op) {
            validateTemplateString(op.path, `Action ${action.id} stateDelta path`);
          }
          if (op.op === "transfer") {
            validateTemplateString(op.fromPath, `Action ${action.id} stateDelta fromPath`);
            validateTemplateString(op.toPath, `Action ${action.id} stateDelta toPath`);
          }
          if (op.op === "set" && typeof op.value === "string") {
            validateTemplateString(op.value, `Action ${action.id} stateDelta value`);
          }
        }
        
        // Check messages
        if (action.messages?.private?.template) {
          validateTemplateString(
            action.messages.private.template, 
            `Action ${action.id} private message`
          );
        }
        if (action.messages?.public?.template) {
          validateTemplateString(
            action.messages.public.template, 
            `Action ${action.id} public message`
          );
        }
      }
    }
    
    // Validate automatic transitions
    for (const [transitionId, transition] of Object.entries(instructions.transitions)) {
      for (const op of transition.stateDelta) {
        if ('path' in op) {
          validateTemplateString(op.path, `Transition ${transition.id} stateDelta path`);
        }
        if (op.op === "transfer") {
          validateTemplateString(op.fromPath, `Transition ${transition.id} stateDelta fromPath`);
          validateTemplateString(op.toPath, `Transition ${transition.id} stateDelta toPath`);
        }
        if (op.op === "set" && typeof op.value === "string") {
          validateTemplateString(op.value, `Transition ${transition.id} stateDelta value`);
        }
      }
      
      if (transition.messages?.private?.template) {
        validateTemplateString(
          transition.messages.private.template, 
          `Transition ${transition.id} private message`
        );
      }
      if (transition.messages?.public?.template) {
        validateTemplateString(
          transition.messages.public.template, 
          `Transition ${transition.id} public message`
        );
      }
    }
    
    if (templateErrors.length > 0) {
      console.error("Template validation errors:", templateErrors);
      throw new Error(`Found ${templateErrors.length} template errors`);
    }
    console.log(`✓ All ${templateCount} template variables are properly formatted`);
    
    // 4. COVERAGE VALIDATION - Compare against transitions artifact
    console.log("\n--- Coverage Validation ---");
    const transitionsArtifactParsed = JSON.parse(transitionsArtifact);
    const coverageErrors: string[] = [];
    
    // Build maps of what instructions were generated
    const instructionPhases = new Set(Object.keys(instructions.playerPhases));
    const automaticTransitionIds = new Set(Object.keys(instructions.transitions));
    
    // Check that phases requiring player input have player phase instructions
    for (const phaseMeta of transitionsArtifactParsed.phaseMetadata) {
      if (phaseMeta.requiresPlayerInput) {
        const phaseInst = instructions.playerPhases[phaseMeta.phase];
        
        if (!phaseInst) {
          coverageErrors.push(
            `Phase '${phaseMeta.phase}' requires player input but has no player phase instructions`
          );
        } else if (phaseInst.playerActions.length === 0) {
          coverageErrors.push(
            `Phase '${phaseMeta.phase}' requires player input but has no player actions`
          );
        }
      } else {
        // Phases that don't require player input should NOT be in playerPhases
        if (instructions.playerPhases[phaseMeta.phase]) {
          coverageErrors.push(
            `Phase '${phaseMeta.phase}' doesn't require player input but has player phase instructions`
          );
        }
      }
    }
    
    // Check that all transitions from non-player-input phases have instructions
    // Transitions from phases requiring player input don't need automatic transition instructions
    const phaseMetadataMap = new Map(
      transitionsArtifactParsed.phaseMetadata.map((pm: any) => [pm.phase, pm])
    );
    
    for (const transition of transitionsArtifactParsed.transitions) {
      const fromPhaseMeta = phaseMetadataMap.get(transition.fromPhase) as any;
      const isAutomaticTransition = fromPhaseMeta && !fromPhaseMeta.requiresPlayerInput;
      
      if (isAutomaticTransition) {
        if (!automaticTransitionIds.has(transition.id)) {
          coverageErrors.push(
            `Automatic transition '${transition.id}' from transitions artifact has no instruction`
          );
        }
      }
    }
    
    if (coverageErrors.length > 0) {
      console.error("Coverage validation errors:", coverageErrors);
      throw new Error(`Found ${coverageErrors.length} coverage errors`);
    }
    console.log(`✓ Complete coverage: All phases and automatic transitions have instructions`);
    
    // 5. PHASE AND TRANSITION ID MATCHING
    console.log("\n--- Phase and Transition ID Matching ---");
    
    const idMatchingErrors: string[] = [];
    
    // Verify instruction phases are subset of transition phases (only those requiring player input)
    const transitionPhases = transitionsArtifactParsed.phases;
    const instructionPhasesArray = Object.keys(instructions.playerPhases);
    const phasesRequiringInput = transitionsArtifactParsed.phaseMetadata
      .filter((pm: any) => pm.requiresPlayerInput)
      .map((pm: any) => pm.phase);
    
    // Player phases should match phases requiring input
    if (JSON.stringify([...phasesRequiringInput].sort()) !== JSON.stringify([...instructionPhasesArray].sort())) {
      idMatchingErrors.push(
        `Phase mismatch:\n  Phases requiring input: ${phasesRequiringInput.join(", ")}\n  Player phase instructions: ${instructionPhasesArray.join(", ")}`
      );
    } else {
      console.log(`✓ Player phase instructions match phases requiring input`);
      console.log(`  Player Phases: ${instructionPhasesArray.join(", ")}`);
    }
    
    // Verify each player phase uses correct phase name
    for (const [phaseName, phaseInst] of Object.entries(instructions.playerPhases)) {
      if (!transitionPhases.includes(phaseInst.phase)) {
        idMatchingErrors.push(
          `Phase instruction uses invalid phase name "${phaseInst.phase}" - not in transitions.phases`
        );
      }
    }
    
    // Verify automatic transition IDs match transition artifact IDs
    const transitionIdsSet = new Set(transitionsArtifactParsed.transitions.map((t: any) => t.id));
    for (const [transitionId, transition] of Object.entries(instructions.transitions)) {
      if (!transitionIdsSet.has(transition.id)) {
        idMatchingErrors.push(
          `Automatic transition "${transition.id}" does not match any transition ID from artifact`
        );
      }
    }
    
    if (idMatchingErrors.length > 0) {
      console.error("Phase/ID matching errors:", idMatchingErrors);
      throw new Error(`Found ${idMatchingErrors.length} phase/ID matching errors`);
    }
    console.log(`✓ All automatic transition IDs match transitions artifact`);
    
    // 6. EXECUTION SMOKE TEST
    console.log("\n--- Execution Smoke Test ---");
    
    // Test 1: Evaluate a real JsonLogic expression
    const testCheck = submitAction!.validation!.checks[0];
    const testData = {
      game: { phase: "choice", round: 1 },
      players: { 
        testPlayer: { choice: null, name: "Alice" },
        p1: { choice: null },
        p2: { choice: null }
      },
      input: { choice: "rock" }
    };
    
    try {
      const result = jsonLogic.apply(testCheck.logic, testData);
      expect(typeof result).toBe("boolean");
      console.log(`✓ JsonLogic smoke test passed: ${testCheck.id} evaluated to ${result}`);
    } catch (e) {
      throw new Error(`JsonLogic smoke test failed: ${e}`);
    }
    
    // Test 2: Simulate applying a StateDelta operation
    const testOp = submitAction!.stateDelta[0];
    expect(testOp.op).toBe("set");
    
    // Mock state application
    const smokeTestState: any = {
      game: { phase: "choice", round: 1 },
      players: { testPlayer: { choice: null, name: "Alice" } }
    };
    
    // Type guard for operations with path and value
    if ('path' in testOp && 'value' in testOp) {
      // Resolve template in path
      const resolvedPath = testOp.path.replace(/\{\{playerId\}\}/g, "testPlayer");
      const resolvedValue = typeof testOp.value === "string" 
        ? testOp.value.replace(/\{\{input\.choice\}\}/g, "rock")
        : testOp.value;
      
      // Apply the operation (simplified)
      const pathParts = resolvedPath.split(".");
      let current: any = smokeTestState;
      for (let i = 0; i < pathParts.length - 1; i++) {
        current = current[pathParts[i]];
      }
      current[pathParts[pathParts.length - 1]] = resolvedValue;
      
      expect(smokeTestState.players.testPlayer.choice).toBe("rock");
      console.log(`✓ StateDelta smoke test passed: Applied ${testOp.op} operation successfully`);
    }
    
    console.log("\n=== All Validations Passed ===");
    console.log("\n=== Extract Instructions Node Test Complete ===");
  }, 120000); // 120s timeout for two-phase LLM calls (planner + executor)
});
