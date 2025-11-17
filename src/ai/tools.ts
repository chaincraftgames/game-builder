import { DallEAPIWrapper } from "@langchain/openai";
import { Tool } from "@langchain/core/tools";
import fetch from "node-fetch";

// export const imageGenTool = new DallEAPIWrapper({
//   n: 1, // Default
//   model: "dall-e-3", // Default
//   apiKey: process.env.CHAINCRAFT_GAMEBUILDER_DALLE_IMAGEGEN_API_KEY, // Default
// });

/**
 * Leonardo API wrapper for LangChain.
 */
class LeonardoAPIWrapper extends Tool {
  name = "leonardo";
  description =
    "A tool that generates images based on text prompts using Leonardo AI";

  private apiKey: string;
  private modelId: string;
  private width: number;
  private height: number;
  private numImages: number;

  constructor({
    apiKey = process.env.LEONARDO_API_KEY,
    modelId = "b24e16ff-06e3-43eb-8d33-4416c2d75876", // Default: Leonardo Phoenix
    width = 1024,
    height = 768,
    numImages = 1,
  } = {}) {
    super();

    if (!apiKey) {
      throw new Error("Leonardo API key is required");
    }

    this.apiKey = apiKey;
    this.modelId = modelId;
    this.width = width;
    this.height = height;
    this.numImages = numImages;
  }

  /** @ignore */
  async _call(
    prompt: string,
    runManager?: any,
    parentConfig?: any
  ): Promise<string | undefined> {
    try {
      // Extract negative prompt from parentConfig if available
      const negativePrompt = parentConfig?.negativePrompt;

      // Step 1: Send a request to generate an image
      const url = "https://cloud.leonardo.ai/api/rest/v1/generations";

      // Prompt can't be more than 1500 characters
      prompt = prompt.substring(0, 1500);
      const requestOptions = {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          height: this.height,
          modelId: this.modelId,
          num_images: this.numImages,
          presetStyle: "DYNAMIC",
          prompt,
          width: this.width,
          userElements:
            this.modelId === "b24e16ff-06e3-43eb-8d33-4416c2d75876"
              ? [{ userLoraId: 59955, weight: 0.8 }]
              : undefined, // Only use LoRA for cartridge model
          negative_prompt: negativePrompt,
        }),
      };
      console.debug(
        "[Leonardo Tool] Generating image with prompt: %s, payload: %s, headers: %o",
        prompt,
        requestOptions.body,
        requestOptions.headers
      );
      const response = await fetch(url, requestOptions);

      console.log(
        "[Leonardo Tool] Generate an image request:",
        response.status
      );

      if (response.status !== 200) {
        console.log("[Leonardo Tool] Response:", response.statusText);
        throw new Error(
          `[Leonardo Tool] Failed to create image generation request: ${response.statusText}`
        );
      }

      let generationId = ((await response.json()) as any).sdGenerationJob
        .generationId;
      console.log("[Leonardo Tool] Generation ID:", generationId);

      console.log(
        "[Leonardo Tool] Waiting for image generation to complete..."
      );
      return await this._waitForImage(generationId);
    } catch (error: any) {
      console.error(
        "[Leonardo Tool] Error:",
        error.response ? error.response.data : error.message
      );
      throw new Error(
        `[Leonardo Tool] Leonardo image generation failed: ${error.message}`
      );
    }
  }

  async _waitForImage(generationId: string): Promise<string | undefined> {
    let isComplete = false;
    let imageUrl = "";
    let maxAttempts = 30; // Maximum number of polling attempts
    let attempts = 0;

    const url = `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`;
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    while (!isComplete && attempts < maxAttempts) {
      // Wait for 3 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const statusResponse = await fetch(url, {
        method: "GET",
        headers,
      });

      if (statusResponse.status !== 200) {
        throw new Error(
          "[Leonardo Tool] Failed to check image generation status"
        );
      }

      const statusData = (await statusResponse.json()) as any;
      console.log(
        `[Leonardo Tool] Polling attempt ${attempts + 1}. Status:`,
        statusData.generations_by_pk?.status
      );

      // Check if generation is complete
      if (statusData.generations_by_pk?.status === "COMPLETE") {
        isComplete = true;

        // Get the URL of the first generated image
        if (statusData.generations_by_pk?.generated_images?.length > 0) {
          imageUrl = statusData.generations_by_pk.generated_images[0].url;
          console.log(
            "[Leonardo Tool] Image generation complete. URL:",
            imageUrl
          );
        } else {
          throw new Error("[Leonardo Tool] No images were generated");
        }
      } else if (statusData.generations_by_pk?.status === "FAILED") {
        throw new Error("[Leonardo Tool] Image generation failed");
      }

      attempts++;
    }

    if (!isComplete) {
      throw new Error(
        "[Leonardo Tool] Image generation timed out after maximum polling attempts"
      );
    }

    return imageUrl;
  }
}

// Leonardo tool for cartridge images (with LoRA)
export const imageGenTool = new LeonardoAPIWrapper({
  modelId: "b24e16ff-06e3-43eb-8d33-4416c2d75876", // Leonardo Creative
  width: 1024,
  height: 768,
  numImages: 1,
  // Use environment variable for API key
  apiKey: process.env.CHAINCRAFT_GAMEBUILDER_LEO_IMAGEGEN_API_KEY,
});

// Leonardo tool for raw images (no LoRA, publishing service settings)
export const rawImageGenTool = new LeonardoAPIWrapper({
  modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3", // Phoenix 1.0
  width: 768,
  height: 576,
  numImages: 1,
  // Use environment variable for API key
  apiKey: process.env.CHAINCRAFT_GAMEBUILDER_LEO_IMAGEGEN_API_KEY,
});
