/**
 * Integration Test for Extract Instructions Node - Narrative Game
 * 
 * Tests the instruction system with a narrative-driven game featuring:
 * - Free-form player dialogue
 * - Relationship/trust mechanics
 * - LLM-driven interpretation and responses
 * - Random events (oracle moods)
 * - Story branching based on narrative state
 */

import { describe, expect, it } from "@jest/globals";
import { setupSpecInstructionsModel } from "#chaincraft/ai/model-config.js";
import { extractInstructions } from "../index.js";
import { InstructionsArtifact } from "#chaincraft/ai/simulate/schema.js";
import { JsonLogicSchema } from "#chaincraft/ai/simulate/logic/jsonlogic.js";
import jsonLogic from "json-logic-js";

describe("Extract Instructions Node - Narrative Game", () => {
  it("should generate instructions for narrative-driven oracle game", async () => {
    const gameSpecification = `
The Oracle is a single-player narrative game where the player seeks wisdom from a mystical oracle.

SETUP:
- Game starts in "approach" phase
- Player has trust level of 50 (neutral)
- Oracle has a random mood: calm (60%), irritable (30%), or cryptic (10%)

APPROACH PHASE:
- Player speaks to the oracle (free-form text input)
- Oracle interprets the player's tone and intent:
  * Respectful/humble: +10 trust
  * Demanding/rude: -15 trust
  * Deceptive: -20 trust
  * Curious/sincere: +5 trust
- Oracle responds based on mood and trust level
- After speaking, transition to "response" phase

RESPONSE PHASE:
- Oracle delivers response based on:
  * Mood: Calm = helpful, Irritable = cryptic, Cryptic = riddles
  * Trust level: High trust (>70) = reveals secret, Low trust (<30) = refuses help
- Player can choose to:
  * "ask_followup": Ask another question (return to approach)
  * "leave": End conversation (go to finished)
  * "offer_gift": Attempt to improve trust (+20 trust, go to approach)

FINISHED PHASE:
- Game ends
- Player receives wisdom based on final trust level:
  * High trust (>70): Profound wisdom
  * Medium trust (30-70): General advice
  * Low trust (<30): Vague platitudes
`;

    const stateSchema = JSON.stringify([
      {
        name: "game",
        type: "object",
        description: "Core game state",
        properties: {
          phase: { 
            name: "phase", 
            type: "string", 
            description: "Current phase: approach, response, or finished" 
          },
          oracleMood: { 
            name: "oracleMood", 
            type: "string", 
            description: "Oracle's current mood: calm, irritable, or cryptic" 
          },
          conversationTurns: {
            name: "conversationTurns",
            type: "number",
            description: "Number of conversation exchanges"
          },
          gameEnded: { 
            name: "gameEnded", 
            type: "boolean", 
            description: "Whether game has ended" 
          }
        }
      },
      {
        name: "player",
        type: "object",
        description: "Player state",
        properties: {
          trust: { 
            name: "trust", 
            type: "number", 
            description: "Trust level with oracle (0-100)" 
          },
          hasOfferedGift: {
            name: "hasOfferedGift",
            type: "boolean",
            description: "Whether player has offered a gift this conversation"
          }
        }
      },
      {
        name: "conversationHistory",
        type: "array",
        description: "Record of conversation exchanges",
        items: {
          type: "object",
          properties: {
            speaker: { name: "speaker", type: "string" },
            message: { name: "message", type: "string" },
            trustChange: { name: "trustChange", type: "number" }
          }
        }
      }
    ]);

    const transitionsArtifact = JSON.stringify({
      phases: ["approach", "response", "finished"],
      phaseMetadata: [
        { phase: "approach", requiresPlayerInput: true },
        { phase: "response", requiresPlayerInput: true },
        { phase: "finished", requiresPlayerInput: false }
      ],
      transitions: [
        {
          id: "player-speaks",
          fromPhase: "approach",
          toPhase: "response",
          condition: "Player submits dialogue",
          checkedFields: ["game.phase"],
          preconditions: [
            {
              id: "in-approach-phase",
              logic: { "==": [{ "var": "game.phase" }, "approach"] },
              deterministic: true,
              explain: "Player can only speak during approach phase"
            }
          ],
          humanSummary: "Player speaks to oracle, triggering response"
        },
        {
          id: "oracle-responds",
          fromPhase: "response",
          toPhase: "response",
          condition: "Oracle generates response",
          checkedFields: ["game.phase"],
          preconditions: [
            {
              id: "response-ready",
              logic: { "==": [{ "var": "game.phase" }, "response"] },
              deterministic: true,
              explain: "Oracle is ready to respond"
            }
          ],
          humanSummary: "Oracle delivers response based on mood and trust"
        },
        {
          id: "ask-followup",
          fromPhase: "response",
          toPhase: "approach",
          condition: "Player asks another question",
          checkedFields: ["game.phase", "game.conversationTurns"],
          preconditions: [
            {
              id: "in-response-phase",
              logic: { "==": [{ "var": "game.phase" }, "response"] },
              deterministic: true,
              explain: "Player can ask followup after oracle responds"
            },
            {
              id: "not-too-many-turns",
              logic: { "<": [{ "var": "game.conversationTurns" }, 5] },
              deterministic: true,
              explain: "Maximum 5 conversation turns"
            }
          ],
          humanSummary: "Player continues conversation"
        },
        {
          id: "offer-gift",
          fromPhase: "response",
          toPhase: "approach",
          condition: "Player offers gift to oracle",
          checkedFields: ["game.phase", "player.hasOfferedGift"],
          preconditions: [
            {
              id: "in-response-phase",
              logic: { "==": [{ "var": "game.phase" }, "response"] },
              deterministic: true,
              explain: "Can only offer gift after oracle responds"
            },
            {
              id: "gift-not-offered",
              logic: { "!": { "var": "player.hasOfferedGift" } },
              deterministic: true,
              explain: "Can only offer one gift per conversation"
            }
          ],
          humanSummary: "Player offers gift to improve trust"
        },
        {
          id: "leave-conversation",
          fromPhase: "response",
          toPhase: "finished",
          condition: "Player chooses to leave",
          checkedFields: ["game.phase"],
          preconditions: [
            {
              id: "in-response-phase",
              logic: { "==": [{ "var": "game.phase" }, "response"] },
              deterministic: true,
              explain: "Player can leave after oracle responds"
            }
          ],
          humanSummary: "Player ends conversation"
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
      playerPhaseInstructions: {},
      transitionInstructions: {},
      exampleState: "",
    };
    
    // Execute node
    console.log("\n=== Executing Extract Instructions Node (Narrative Game) ===\n");
    const result = await node(inputState);
    
    // Parse result
    expect(result.playerPhaseInstructions).toBeDefined();
    expect(result.transitionInstructions).toBeDefined();
    
    // Reconstruct full artifact from separated maps
    const playerPhaseInstructionsMap = JSON.parse(result.playerPhaseInstructions!.all || '{}');
    const transitionInstructionsMap = JSON.parse(result.transitionInstructions!.all || '{}');
    
    const instructions: InstructionsArtifact = {
      version: "1.0",
      generatedAt: new Date().toISOString(),
      playerPhases: playerPhaseInstructionsMap,
      transitions: transitionInstructionsMap,
      metadata: {
        totalPlayerPhases: Object.keys(playerPhaseInstructionsMap).length,
        totalTransitions: Object.keys(transitionInstructionsMap).length,
        deterministicInstructionCount: 0,
        llmDrivenInstructionCount: 0
      }
    };
    
    // Save output for debugging
    const fs = await import('fs');
    await fs.promises.writeFile(
      '/tmp/instructions-output-narrative.json',
      JSON.stringify(instructions, null, 2),
      'utf-8'
    );
    console.log("Saved full output to /tmp/instructions-output-narrative.json");
    
    console.log("\n=== Instructions Artifact (Narrative) ===");
    console.log(`Version: ${instructions.version}`);
    console.log(`Player Phases: ${Object.keys(instructions.playerPhases).join(", ")}`);
    console.log(`Total Player Phases: ${instructions.metadata.totalPlayerPhases}`);
    console.log(`Total Transitions: ${instructions.metadata.totalTransitions}`);
    console.log(`LLM-Driven Instructions: ${instructions.metadata.llmDrivenInstructionCount}`);
    
    console.log("\n=== Narrative-Specific Validation ===");
    
    // Player phases are already a Record keyed by phase name
    const playerPhases = instructions.playerPhases;

    // 1. APPROACH PHASE - Free-form dialogue
    const approachPhase = playerPhases["approach"];
    expect(approachPhase).toBeDefined();
    
    const speakAction = approachPhase.playerActions.find(
      (a: any) => a.actionName.toLowerCase().includes("speak") || 
                  a.actionName.toLowerCase().includes("dialogue") ||
                  a.id === "player-speaks"
    );
    expect(speakAction).toBeDefined();
    
    // Should have mechanics guidance for interpreting player tone
    if (speakAction?.mechanicsGuidance) {
      expect(speakAction.mechanicsGuidance.rules).toBeDefined();
      expect(Array.isArray(speakAction.mechanicsGuidance.rules)).toBe(true);
      expect(speakAction.mechanicsGuidance.rules.length).toBeGreaterThan(0);
      
      const rulesText = speakAction.mechanicsGuidance.rules.join(" ").toLowerCase();
      expect(
        rulesText.includes("trust") || 
        rulesText.includes("tone") || 
        rulesText.includes("respect") ||
        rulesText.includes("interpret")
      ).toBe(true);
      
      console.log(`✓ Speak action has ${speakAction.mechanicsGuidance.rules.length} mechanics rules for tone interpretation`);
    } else {
      console.warn("⚠ Speak action missing mechanics guidance (LLM may have simplified)");
    }
    
    // Should have template variables for LLM-resolved values
    expect(Array.isArray(speakAction?.stateDelta)).toBe(true);
    expect(speakAction?.stateDelta.length).toBeGreaterThan(0);
    
    // Check for trust modification operations
    const trustOps = speakAction?.stateDelta.filter((op: any) => 
      (op.path && op.path.includes("trust")) || 
      (op.op === "increment" && op.path?.includes("player"))
    );
    expect(trustOps?.length).toBeGreaterThan(0);
    console.log(`✓ Speak action has ${trustOps?.length} trust-related state operations`);

    // 2. RESPONSE PHASE - Oracle responds
    // Response phase transitions are in the transitions map
    const oracleResponseTransition = Object.values(instructions.transitions).find(
      (t: any) => t.id === "oracle-responds" || 
                  t.transitionName.toLowerCase().includes("respond")
    );
    expect(oracleResponseTransition).toBeDefined();
    
    // Should have mechanics for mood-based responses
    if (oracleResponseTransition?.mechanicsGuidance) {
      expect(oracleResponseTransition.mechanicsGuidance.rules).toBeDefined();
      expect(Array.isArray(oracleResponseTransition.mechanicsGuidance.rules)).toBe(true);
      
      const rulesText = oracleResponseTransition.mechanicsGuidance.rules.join(" ").toLowerCase();
      expect(
        rulesText.includes("mood") || 
        rulesText.includes("calm") || 
        rulesText.includes("irritable") ||
        rulesText.includes("trust")
      ).toBe(true);
      
      console.log(`✓ Oracle response has ${oracleResponseTransition.mechanicsGuidance.rules.length} mechanics rules for mood-based responses`);
    }
    
    // Should check for RNG configuration (oracle mood)
    const rngTransitions = Object.values(instructions.transitions).filter(t => t.rngConfig);
    if (rngTransitions.length > 0) {
      console.log(`✓ Found ${rngTransitions.length} transitions with RNG configuration (oracle mood)`);
    } else {
      console.log(`ℹ No RNG transitions found (mood may be set in setup)`);
    }

    // 3. PLAYER CHOICE ACTIONS - offer gift, ask followup, leave
    // Get all player actions from player phases
    const allActions = Object.values(instructions.playerPhases).flatMap(p => p.playerActions);
    const choiceActions = allActions;
    expect(choiceActions.length).toBeGreaterThan(0);
    
    const offerGiftAction = choiceActions.find(
      (a: any) => a.id === "offer-gift" || 
                  a.actionName.toLowerCase().includes("gift")
    );
    
    if (offerGiftAction) {
      // Gift should modify trust
      const giftTrustOps = offerGiftAction.stateDelta.filter((op: any) =>
        op.path?.includes("trust")
      );
      expect(giftTrustOps.length).toBeGreaterThan(0);
      console.log(`✓ Gift action has trust modification`);
    }

    // 4. VALIDATE ALL JSONLOGIC IS EXECUTABLE
    console.log("\n--- JsonLogic Validation (Narrative) ---");
    let jsonLogicCount = 0;
    let jsonLogicErrors: string[] = [];
    
    for (const phaseInst of Object.values(instructions.playerPhases)) {
      for (const action of phaseInst.playerActions) {
        if (action.validation?.checks) {
          for (const check of action.validation.checks) {
            jsonLogicCount++;
            const parseResult = JsonLogicSchema.safeParse(check.logic);
            if (!parseResult.success) {
              jsonLogicErrors.push(`Action ${action.id} check ${check.id}: ${parseResult.error.message}`);
            }
            
            try {
              const mockData = {
                game: { phase: "approach", conversationTurns: 2 },
                player: { trust: 50, hasOfferedGift: false }
              };
              jsonLogic.apply(check.logic, mockData);
            } catch (e) {
              jsonLogicErrors.push(`Action ${action.id} check ${check.id}: Eval failed - ${e}`);
            }
          }
        }
      }
    }
    
    // Router handles preconditions via stateTransitions artifact
    // Instructions don't need trigger.preconditions anymore
    for (const transition of Object.values(instructions.transitions)) {
      // Validation disabled - trigger.preconditions removed from schema
    }
    
    if (jsonLogicErrors.length > 0) {
      console.error("JsonLogic errors:", jsonLogicErrors);
      throw new Error(`Found ${jsonLogicErrors.length} JsonLogic errors`);
    }
    console.log(`✓ All ${jsonLogicCount} JsonLogic expressions are valid and executable`);

    // 5. VALIDATE TEMPLATE VARIABLES
    console.log("\n--- Template Variable Validation (Narrative) ---");
    let templateCount = 0;
    let narrativeTemplates: string[] = [];
    
    const collectTemplates = (str: string) => {
      if (!str) return;
      const matches = str.match(/\{\{([^}]+)\}\}/g);
      if (matches) {
        templateCount += matches.length;
        matches.forEach(m => {
          const varName = m.slice(2, -2).trim();
          if (!narrativeTemplates.includes(varName)) {
            narrativeTemplates.push(varName);
          }
        });
      }
    };
    
    // Check player action templates
    for (const phaseInst of Object.values(instructions.playerPhases)) {
      for (const action of phaseInst.playerActions) {
        action.stateDelta.forEach((op: any) => {
          if ('path' in op) collectTemplates(op.path);
          if (op.value && typeof op.value === 'string') collectTemplates(op.value);
        });
        
        if (action.messages?.private?.template) {
          collectTemplates(action.messages.private.template);
        }
        if (action.messages?.public?.template) {
          collectTemplates(action.messages.public.template);
        }
      }
    }
    
    // Check transition templates separately
    for (const transition of Object.values(instructions.transitions)) {
      transition.stateDelta.forEach((op: any) => {
        if ('path' in op) collectTemplates(op.path);
        if (op.value && typeof op.value === 'string') collectTemplates(op.value);
      });
      
      if (transition.messages?.private?.template) {
        collectTemplates(transition.messages.private.template);
      }
      if (transition.messages?.public?.template) {
        collectTemplates(transition.messages.public.template);
      }
    }
    
    console.log(`✓ Found ${templateCount} template variable usages`);
    console.log(`✓ Unique narrative template variables: ${narrativeTemplates.join(", ")}`);
    
    // Expect narrative-specific templates like oracleResponse, trustChange, etc.
    const hasNarrativeTemplates = narrativeTemplates.some(v => 
      v.toLowerCase().includes("oracle") || 
      v.toLowerCase().includes("trust") ||
      v.toLowerCase().includes("response") ||
      v.toLowerCase().includes("message")
    );
    expect(hasNarrativeTemplates).toBe(true);
    console.log(`✓ Instructions include narrative-specific template variables`);

    // 6. VALIDATE LLM-DRIVEN COUNT
    expect(instructions.metadata.llmDrivenInstructionCount).toBeGreaterThan(0);
    console.log(`✓ ${instructions.metadata.llmDrivenInstructionCount} LLM-driven instructions (expected for narrative game)`);
    
    // Narrative games should have MORE LLM-driven than deterministic
    const llmRatio = instructions.metadata.llmDrivenInstructionCount / 
                     (instructions.metadata.totalPlayerPhases + instructions.metadata.totalTransitions);
    console.log(`✓ LLM-driven ratio: ${(llmRatio * 100).toFixed(0)}% (narrative games should be high)`);

    console.log("\n=== All Narrative Validations Passed ===");
    console.log("\n=== Extract Instructions Node Test Complete (Narrative) ===");
  }, 180000); // 180s timeout for larger narrative game generation
});
