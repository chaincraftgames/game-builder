/**
 * Quick test: Can we use multiple SystemMessage instances with LangChain Anthropic?
 */

import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { setupModel } from '#chaincraft/ai/model-config.js';

async function testMultipleSystemMessages() {
  console.log('\n=== Testing Multiple System Messages ===\n');

  const model = await setupModel({
    modelName: 'claude-haiku-4-5-20251001',
    maxTokens: 100
  });

  try {
    const messages = [
      new SystemMessage("You are a helpful assistant."),
      new SystemMessage("You should be concise."),
      new HumanMessage("What is 2+2?")
    ];

    console.log('Sending messages:');
    messages.forEach((msg, i) => {
      console.log(`  ${i + 1}. ${msg._getType()}: ${msg.content.toString().substring(0, 50)}...`);
    });
    console.log('');

    const response = await model.invokeWithMessages(messages);
    
    console.log('✓ SUCCESS: Multiple system messages work!');
    console.log(`Response: ${response.content}\n`);
    
    return true;
  } catch (error: any) {
    console.error('✗ FAILED: Multiple system messages not supported');
    console.error(`Error: ${error.message}\n`);
    return false;
  }
}

describe('Multiple System Messages Test', () => {
  it('should support multiple system messages', async () => {
    const result = await testMultipleSystemMessages();
    expect(result).toBe(true);
  }, 30000);
});
