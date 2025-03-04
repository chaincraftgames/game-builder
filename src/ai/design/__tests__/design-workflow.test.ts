import { continueDesignConversation, generateImage } from "../design-workflow.js";

let conversationId = `test-conversation-${Date.now()}`;

async function testDesignWorkflow() {
  console.log("Starting design workflow test...");

  // Create a simple game description
  const gameDescription = "A card game where players collect resources and build a medieval castle";
  
  try {
    // Send an initial prompt to the conversation
    console.log("Sending initial prompt to conversation...");
    
    const response = await continueDesignConversation(conversationId, "Let's begin", gameDescription);
    const prompt = "What game mechanics would work well for resource collection in this game?";
    const response2 = await continueDesignConversation(conversationId,prompt);
    const prompt2 = "Let's add a drafting mechanic to the game.";
    const response3 = await continueDesignConversation(conversationId,prompt2);
    const prompt3 = "This looks great!  Can I get the final game description for this game?";
    const response4 = await continueDesignConversation(conversationId,prompt3);

    
    console.log("\nGame Description:", gameDescription);
    console.log("\Response:", response);
    console.log("\nPrompt:", prompt);
    console.log("\nResponse:", response2);
    console.log("\nPrompt:", prompt2);
    console.log("\nResponse:", response3);
    console.log("\nPrompt:", prompt3);
    console.log("\nResponse:", response4);
    
  } catch (error) {
    console.error("Error in design workflow test:", error);
  }
}

async function testImageGeneration() {
  console.log("Starting image generation test...");

  try {
    // Generate an image based on the established design
    console.log("Generating image...");
    const imageUrl = await generateImage(conversationId);
    
    if (!imageUrl || !imageUrl.startsWith('http')) {
      throw new Error('Invalid image URL generated');
    }
    
    console.log("Successfully generated image:", imageUrl);
    
  } catch (error) {
    console.error("Error in image generation test:", error);
  }
}

// Run the tests
async function runTests() {
  await testDesignWorkflow();
  await testImageGeneration();
}

runTests();