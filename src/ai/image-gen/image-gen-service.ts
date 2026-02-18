import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { LeonardoAPIWrapper, LeonardoConfig } from "#chaincraft/ai/tools.js";
import { OverloadedError } from "#chaincraft/ai/error.js";
import { setupDesignModel } from "#chaincraft/ai/model-config.js";

// ── Config types ──────────────────────────────────────────────────────────

/**
 * Full configuration for an image generation run.
 * Combines Leonardo API settings with prompt configuration.
 */
export interface ImageGenConfig {
  /** Leonardo API settings. */
  leonardo: LeonardoConfig;
  /** Prompt template sent to Leonardo. Uses {placeholders} for variable substitution. */
  promptTemplate: string;
  /** Optional negative prompt for Leonardo. */
  negativePrompt?: string;
  /**
   * Optional LLM system prompt for a two-step flow.
   * When provided, an LLM first generates an image description from the context,
   * then that description is injected into the promptTemplate as {image_description}.
   * When omitted, context is injected directly into the promptTemplate (single-step).
   */
  descriptionSystemPrompt?: string;
  /** Max characters for the image description (default: 600). */
  descriptionMaxChars?: number;
}

// ── Preset configs ────────────────────────────────────────────────────────

const LEO_API_KEY = process.env.CHAINCRAFT_GAMEBUILDER_LEO_IMAGEGEN_API_KEY;

/**
 * Cartridge-style game box art (with LoRA).
 * Two-step: LLM describes the image → Leonardo generates a cartridge image.
 */
export const CARTRIDGE_IMAGE_CONFIG: ImageGenConfig = {
  leonardo: {
    modelId: "b24e16ff-06e3-43eb-8d33-4416c2d75876", // Leonardo Creative
    width: 1024,
    height: 768,
    numImages: 1,
    userElements: [{ userLoraId: 59955, weight: 0.8 }],
    apiKey: LEO_API_KEY,
  },
  promptTemplate: `A 4:3 landscape image of a gray plastic video game cartridge from the 1990s for 
the fictional console 'CHAINCRAFT.' The cartridge is wide, centered, and 
front-facing. It floats on a flat, solid dark gray background, with no shadows 
or gradients. The plastic is worn with scratches and grooves.

A large, retro-style label with chipped edges covers most of the front. The label 
features colorful 1990s-style game cover art inspired by:

{image_description}

The game title {game_title} is clearly printed at the top of the label in bold text. 
The title is fully visible, with no distortion. Below the label is an embossed "CHAINCRAFT" logo 
molded into the plastic cartridge.`,
  descriptionSystemPrompt: `You are a concept artist for a game design company.  You are tasked with creating images for a game that has been designed by the game design team.
    
Come up with a description of an image that represents the game design suitable for the image on the box of the game.  
Don't just specify an image that depicts players playing the game or the game components such as boards, cards, etc... 
Instead, think of an image that captures the essence of the game, the feeling that the game is meant to evoke, and what
makes it unique and fun.  Make the image interesting and engaging, something that would make someone want to pick up the game and play it.   
Your task is to describe the image to be created in detail so that an generative AI can create the image.  
Make sure to include all the details that are important to the image, e.g. the setting, the characters, the mood, the colors, etc...

Please limit the description to 600 characters.`,
};

/**
 * Raw retro game art (no LoRA, for publishing).
 * Two-step: LLM describes the image → Leonardo generates raw art.
 */
export const RAW_IMAGE_CONFIG: ImageGenConfig = {
  leonardo: {
    modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3", // Phoenix 1.0
    width: 768,
    height: 576,
    numImages: 1,
    apiKey: LEO_API_KEY,
  },
  promptTemplate: `Retro video game art illustration, 1980s-1990s style with vibrant hand-drawn aesthetic and slightly faded vintage appearance. 
IMPORTANT: The title "{game_title}" must be prominently displayed in bold lettering near the top of the image, 
fully integrated into the design. Typography style, color, and effects must authentically match the game's 
specific genre and emotional tone.

Full bleed artwork depicting: {image_description}

Title "{game_title}" rendered in period-accurate typography with thematically-driven styling. 
Classic colorful 1980s-1990s gaming art style with dramatic composition, bold colors, and authentic 
period-appropriate details.`,
  negativePrompt: `no text, missing title, blank title area, wrong font style, modern fonts, yellow gradient text, orange gradient text, generic title colors, border, frame, box, cartridge, case, package, product, margin, white space, black border, edge border, outline, container, packaging, 3D render, game case, rectangular frame, modern digital art, photo realistic, UI elements, watermark, logo, breathing room, padding, inset`,
  descriptionSystemPrompt: `You are a concept artist for a game design company.  You are tasked with creating images for a game that has been designed by the game design team.
    
Come up with a description of an image that represents the game design suitable for the image on the box of the game.  
Don't just specify an image that depicts players playing the game or the game components such as boards, cards, etc... 
Instead, think of an image that captures the essence of the game, the feeling that the game is meant to evoke, and what
makes it unique and fun.  Make the image interesting and engaging, something that would make someone want to pick up the game and play it.   
Your task is to describe the image to be created in detail so that an generative AI can create the image.  
Make sure to include all the details that are important to the image, e.g. the setting, the characters, the mood, the colors, etc...

Please limit the description to 600 characters.`,
};

/**
 * Token image generation (direct prompt, no LLM description step).
 * Single-step: token description + data are injected directly into the prompt.
 */
export const TOKEN_IMAGE_CONFIG: ImageGenConfig = {
  leonardo: {
    modelId: "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3", // Phoenix 1.0
    width: 832,
    height: 1216,
    numImages: 1,
    apiKey: LEO_API_KEY,
  },
  promptTemplate: `
Data for the image to be generated:
{token_description}

{token_data}  

vintage retro video game trading card full card illustration, vertical 
2:3, bold illustrated border inspired by 1980s and 1990s video game 
box art, chunky painted frame with bright primary color accents, bold 
geometric corner details, slightly worn printed cardboard texture on 
frame edges only, vivid limited color palette feel, symmetrical card 
layout, the upper two-thirds of the card features a painted portrait 
of the character, item, ability, or achievement described above, 
rendered in vintage retro video game box art 
illustration style, vivid saturated colors, dramatic but flat 
studio-style lighting with no heavy shadows, clean cel-shaded edges, 
the portrait blends naturally into a subtle bold color atmospheric 
background with no hard borders or inset frames around the portrait 
area, seamlessly flush with generous room on all sides, the lower 
third is a clean flat darker footer panel matching the card palette, 
completely empty, no text, no icons; decorative border surrounds 
card exterior only, no text or symbols anywhere, no harsh shadows 
on card interior, square portrait composition
`,
  negativePrompt: `
    text, letters, words, numbers, stats, icons, logos, watermarks, UI 
labels, stat boxes, inner border, inset frame, raised edge, bevel, 
stroke around image zone, recessed panel, shadow around rectangle, 
frame within frame, dark vignette, lighting gradient in center zone, 
glow inside image area, texture inside image zone, shadows in art 
area, realistic photography, hyper-detailed rendering, photorealistic 
materials, blurry, noise, low quality, asymmetric design, multiple 
characters, busy background, detailed background, ground or floor 
visible

  `,
  // No descriptionSystemPrompt → single-step direct prompt
};

// ── Service functions ─────────────────────────────────────────────────────

/**
 * Generate an image using a two-step flow:
 *   1. LLM produces a text description from contextText
 *   2. Description is injected into config.promptTemplate and sent to Leonardo
 *
 * Use this for design images (box art) where creative interpretation is needed.
 *
 * @param contextText Source material for the LLM (e.g., game summary)
 * @param templateVars Additional variables to substitute in the prompt template (e.g., {game_title})
 * @param config Image generation configuration (must include descriptionSystemPrompt)
 * @returns Image URL
 */
export async function generateImageWithDescription(
  contextText: string,
  templateVars: Record<string, string>,
  config: ImageGenConfig,
): Promise<string> {
  if (!config.descriptionSystemPrompt) {
    throw new Error(
      "generateImageWithDescription requires a descriptionSystemPrompt in config"
    );
  }

  // Step 1: LLM generates image description
  const modelWithOptions = await setupDesignModel();
  const maxChars = config.descriptionMaxChars ?? 600;

  const imageDesign = await modelWithOptions
    .invokeWithMessages(
      [
        new SystemMessage(config.descriptionSystemPrompt),
        new HumanMessage(contextText),
      ],
      {
        agent: "image-description-generator",
        workflow: "image-gen",
      }
    )
    .catch((error) => {
      if (error.type && error.type === "overloaded_error") {
        throw new OverloadedError(error.message);
      }
      throw error;
    });

  if (!imageDesign.content) {
    throw new Error("Failed to generate image description: no content");
  }

  const description = imageDesign.content.toString().substring(0, maxChars);

  // Step 2: Build Leonardo prompt and generate
  const allVars = { ...templateVars, image_description: description };
  return _generateWithLeonardo(allVars, config, modelWithOptions.getCallbacks());
}

/**
 * Generate an image using a single-step direct prompt flow.
 * Template variables are injected directly into the prompt template and sent to Leonardo.
 *
 * Use this for token images where you already have concrete description + data.
 *
 * @param templateVars Variables to substitute in the prompt template (e.g., {token_description}, {token_data})
 * @param config Image generation configuration
 * @returns Image URL
 */
export async function generateImageDirect(
  templateVars: Record<string, string>,
  config: ImageGenConfig,
): Promise<string> {
  return _generateWithLeonardo(templateVars, config);
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function _generateWithLeonardo(
  templateVars: Record<string, string>,
  config: ImageGenConfig,
  callbacks?: any[],
): Promise<string> {
  // Simple string interpolation for {placeholder} vars — avoids the complexity
  // of SystemMessagePromptTemplate which returns a message object
  let prompt = config.promptTemplate;
  for (const [key, value] of Object.entries(templateVars)) {
    prompt = prompt.split(`{${key}}`).join(value);
  }

  console.debug("[ImageGen] Final prompt (%d chars): %s", prompt.length, prompt);

  const tool = new LeonardoAPIWrapper(config.leonardo);

  const imageUrl = await tool
    .invoke(prompt, {
      callbacks,
      metadata: {
        agent: "image-generator",
        workflow: "image-gen",
      },
      negativePrompt: config.negativePrompt,
    })
    .catch((error) => {
      if (error.type && error.type === "overloaded_error") {
        throw new OverloadedError(error.message);
      }
      throw error;
    });

  if (!imageUrl) {
    throw new Error("Image generation failed: no image URL returned");
  }

  return imageUrl;
}
