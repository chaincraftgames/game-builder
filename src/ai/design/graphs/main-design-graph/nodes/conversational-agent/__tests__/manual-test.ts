#!/usr/bin/env node
/**
 * Manual test script for the Conversational Design Agent
 * 
 * Run with: npm run build && node dist/ai/design/graphs/main-design-graph/nodes/conversational-agent/__tests__/manual-test.js
 */

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { setupDesignModel } from "#chaincraft/ai/model-config.js";
import { createConversationalAgent } from "../index.js";
import { GameDesignState } from "#chaincraft/ai/design/game-design-state.js";

// Mock registries
const MECHANICS_REGISTRY = `
- Deck Building: Players construct decks during the game
- Area Control: Players compete for control of board spaces  
- Resource Management: Players collect and spend resources
- Drafting: Players select cards from a shared pool
- Hand Management: Strategic card play from limited hand
`;

const CONSTRAINTS_REGISTRY = `
NOT SUPPORTED:
- Real-time action games requiring split-second timing
- Games with complex physics simulations

SUPPORTED WITH LIMITATIONS:
- Card games with complex interactions (may need clarification)
- Large boards with 100+ spaces (performance considerations)
`;

async function runTest(testName: string, messages: any[], expectedFlags: any) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log("=".repeat(60));
  
  const model = await setupDesignModel();
  const agent = await createConversationalAgent(
    model,
    CONSTRAINTS_REGISTRY,
    MECHANICS_REGISTRY
  );

  const state = {
    messages: [],
    title: "",
    systemPromptVersion: "1.0",
    specRequested: false,
    currentGameSpec: undefined,
    specVersion: 0,
    specUpdateNeeded: false,
    metadataUpdateNeeded: false,
    specPlan: undefined,
    metadataChangePlan: undefined,
    spec: undefined,
    updatedSpec: undefined,
    metadata: undefined,
    specDiff: undefined,
    metadataDiff: undefined,
    validationErrors: [],
    retryCount: 0,
    lastSpecUpdate: undefined,
    lastMetadataUpdate: undefined,
    lastSpecMessageCount: undefined,
    metadataPlan: undefined,
  };  console.log("\n📨 INPUT:");
  messages.forEach(msg => {
    const role = msg instanceof HumanMessage ? "USER" : "ASSISTANT";
    console.log(`  ${role}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
  });

  const result = await agent(state);

  console.log("\n🤖 RESPONSE:");
  console.log(result.messages[0].content);
  
  console.log("\n📊 FLAGS:");
  console.log(`  Game Title: ${result.title || '(none)'}`);
  console.log(`  Spec Update Needed: ${result.specUpdateNeeded} ${result.specUpdateNeeded === expectedFlags.spec ? '✅' : '❌ Expected: ' + expectedFlags.spec}`);
  console.log(`  Metadata Update Needed: ${result.metadataUpdateNeeded} ${result.metadataUpdateNeeded === expectedFlags.metadata ? '✅' : '❌ Expected: ' + expectedFlags.metadata}`);
  
  return result;
}

async function main() {
  console.log("🎮 Conversational Design Agent - Manual Test Suite");
  console.log("==================================================\n");

  try {
    // Test 1: Initial conversation (no updates)
    await runTest(
      "Initial Game Idea",
      [
        new HumanMessage("I want to create a deck-building game about space exploration")
      ],
      { spec: false, metadata: false }
    );

    // Test 2: Defining game rules (should trigger spec update)
    await runTest(
      "Defining Game Rules",
      [
        new HumanMessage("I want a card game"),
        new AIMessage("Great! Tell me more about the gameplay."),
        new HumanMessage("Players start with 5 cards, draw 1 per turn, and play cards to gain resources. First to 10 resources wins.")
      ],
      { spec: true, metadata: false }
    );

    // Test 3: Describing game components (should trigger metadata)
    await runTest(
      "Describing Game Components",
      [
        new HumanMessage("I need help designing a dice game"),
        new AIMessage("Sounds fun! What components do you need?"),
        new HumanMessage("Players use two 6-sided dice and collect wooden tokens in 3 colors: red, blue, and green")
      ],
      { spec: false, metadata: true }
    );

    // Test 4: Both rules and components (should trigger both flags)
    await runTest(
      "Rules + Components Together",
      [
        new HumanMessage("The game uses a 52-card deck where each card has attack and defense values. Players draw 3 cards per turn and play one card to attack their opponent.")
      ],
      { spec: true, metadata: true }
    );

    // Test 5: Explicit spec request
    await runTest(
      "Explicit Spec Request",
      [
        new HumanMessage("I want to make a trading game"),
        new AIMessage("Interesting! Medieval or modern setting?"),
        new HumanMessage("Medieval. Players trade goods between cities."),
        new AIMessage("Nice! Any special mechanics?"),
        new HumanMessage("Please generate the full game specification now.")
      ],
      { spec: true, metadata: false }
    );

    // Test 6: Clarification question (no updates)
    await runTest(
      "Asking Clarification",
      [
        new HumanMessage("What if we made it a cooperative game instead?")
      ],
      { spec: false, metadata: false }
    );

    console.log("\n" + "=".repeat(60));
    console.log("✅ All manual tests completed!");
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Error running tests:", error);
    process.exit(1);
  }
}

main();
