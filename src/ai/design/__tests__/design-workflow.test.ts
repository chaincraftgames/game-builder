import { continueDesignConversation, generateImage } from "../design-workflow.js";

let conversationId = `test-conversation-${Date.now()}`;

async function testDesignWorkflow() {
  console.log("\n=== DESIGN WORKFLOW TEST ===\n");
  console.log("Conversation ID:", conversationId);

  try {
    // Turn 1: Initial request (agent may generate spec or ask questions)
    console.log("\n--- TURN 1: Initial Request ---");
    const response1 = await continueDesignConversation(
      conversationId, 
      "Create a simple dice rolling game for 2 players."
    );
    
    console.log("✓ Response:", response1.designResponse.substring(0, 150) + "...");
    console.log("✓ Spec Generated:", !!response1.specification);
    
    let initialSpec;
    let nextTurnNumber = 2;
    
    if (response1.specification) {
      console.log("✓ Agent generated spec immediately on turn 1");
      console.log("✓ Version:", response1.specification.version);
      initialSpec = response1.specification;
    } else {
      console.log("✓ Agent started conversation (will request spec on turn 2)");
      
      // Turn 2: Request spec generation explicitly
      console.log("\n--- TURN 2: Request Spec Generation ---");
      const response2 = await continueDesignConversation(
        conversationId,
        "Can you create the game specification for this?"
      );
      
      console.log("✓ Response:", response2.designResponse.substring(0, 150) + "...");
      console.log("✓ Spec Generated:", !!response2.specification);
      console.log("✓ Version:", response2.specification?.version);
      
      if (!response2.specification) {
        throw new Error("Spec should be generated after explicit request");
      }
      
      initialSpec = response2.specification;
      nextTurnNumber = 3;
    }


    // Now test spec consolidation with accumulated changes
    console.log(`\n--- TURN ${nextTurnNumber}: Accumulate Change ---`);
    const responseAccum1 = await continueDesignConversation(
      conversationId,
      "Add a scoring system."
    );
    
    console.log("✓ Response:", responseAccum1.designResponse.substring(0, 150) + "...");
    console.log("✓ Spec Updated:", !!responseAccum1.specDiff);
    console.log("✓ Pending Changes:", responseAccum1.pendingSpecChanges?.length || 0);
    console.log("✓ Consolidation Threshold:", responseAccum1.consolidationThreshold);
    
    if (responseAccum1.pendingSpecChanges && responseAccum1.pendingSpecChanges.length > 0) {
      console.log("✓ Changes are accumulating (as expected)");
      console.log("  Pending change:", responseAccum1.pendingSpecChanges[0].substring(0, 100) + "...");
    } else {
      console.log("⚠ No pending changes accumulated (may have auto-consolidated)");
    }

    // Add another change
    console.log(`\n--- TURN ${nextTurnNumber + 1}: Add Another Change ---`);
    const responseAccum2 = await continueDesignConversation(
      conversationId,
      "Add a timer to make it more exciting."
    );
    
    console.log("✓ Response:", responseAccum2.designResponse.substring(0, 150) + "...");
    console.log("✓ Pending Changes:", responseAccum2.pendingSpecChanges?.length || 0);
    console.log("✓ Spec Version:", responseAccum2.specification?.version || initialSpec.version);

    // Force generation to consolidate pending changes
    console.log(`\n--- TURN ${nextTurnNumber + 2}: Force Spec Generation ---`);
    const responseFinal = await continueDesignConversation(
      conversationId,
      "Add victory conditions.",
      undefined,
      true // Force spec generation
    );
    
    console.log("✓ Response:", responseFinal.designResponse.substring(0, 150) + "...");
    console.log("✓ Spec Generated:", !!responseFinal.specification);
    console.log("✓ Version:", responseFinal.specification?.version);
    console.log("✓ Pending Changes:", responseFinal.pendingSpecChanges?.length || 0);
    console.log("✓ Spec Diff:", !!responseFinal.specDiff);
    
    if (responseFinal.pendingSpecChanges && responseFinal.pendingSpecChanges.length === 0) {
      console.log("✓ Pending changes cleared (as expected)");
    }
    
    if (responseFinal.specification && responseFinal.specification.version > initialSpec.version) {
      console.log("✓ Version incremented (as expected)");
    }

    // Summary
    console.log("\n--- SUMMARY ---");
    console.log("Initial version:", initialSpec.version);
    console.log("Final version:", responseFinal.specification?.version || "unknown");
    console.log("Total turns:", nextTurnNumber + 2);
    console.log("Final title:", responseFinal.updatedTitle || "Untitled");
    
    console.log("\n✅ Design workflow test completed successfully!");
    
    return responseFinal;
    
  } catch (error) {
    console.error("\n❌ Error in design workflow test:", error);
    throw error;
  }
}

async function testImageGeneration() {
  console.log("\n=== IMAGE GENERATION TEST ===\n");

  try {
    console.log("Generating image for conversation:", conversationId);
    const imageUrl = await generateImage(conversationId);
    
    if (!imageUrl || !imageUrl.startsWith('http')) {
      throw new Error('Invalid image URL generated');
    }
    
    console.log("✅ Successfully generated image:", imageUrl);
    
  } catch (error) {
    console.error("❌ Error in image generation test:", error);
    throw error;
  }
}

// Run the tests
async function runTests() {
  try {
    await testDesignWorkflow();
    await testImageGeneration();
    console.log("\n🎉 All tests passed!\n");
  } catch (error) {
    console.error("\n💥 Tests failed:", error);
    process.exit(1);
  }
}

runTests();