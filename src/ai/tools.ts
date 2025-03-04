import { DallEAPIWrapper } from "@langchain/openai";

export const imageGenTool = new DallEAPIWrapper({
  n: 1, // Default
  model: "dall-e-3", // Default
  apiKey: process.env.CHAINCRAFT_GAMEBUILDER_IMAGEGEN_API_KEY, // Default
});