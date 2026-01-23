/**
 * Prompt Template Processor with Cache Support
 * 
 * Processes templates with cache markers to enable prompt caching.
 * Markers format: !___ CACHE:section-name ___! ... !___ END-CACHE ___!
 */

import { SystemMessage } from "@langchain/core/messages";

/**
 * Content block that may have cache control
 */
export interface ContentBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * Processed template ready for LLM invocation
 */
export interface ProcessedTemplate {
  content: ContentBlock[];
  hasCacheMarkers: boolean;
}

/**
 * Parse template with cache markers into content blocks
 * 
 * @param template - Template string with optional !___ CACHE:name ___! markers
 * @param variables - Variables to substitute in template (standard {placeholder} format)
 * @returns Array of content blocks with cache_control markers
 */
export function processCachedTemplate(
  template: string,
  variables: Record<string, string> = {}
): ProcessedTemplate {
  // First, substitute variables using standard {placeholder} syntax
  let processed = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    processed = processed.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  // Check if template has cache markers
  const hasCacheMarkers = /!___ CACHE:[\w-]+ ___!/.test(processed);
  
  if (!hasCacheMarkers) {
    // No cache markers - return as single text block
    return {
      content: [{ type: "text", text: processed }],
      hasCacheMarkers: false,
    };
  }

  // Split by cache markers and build content blocks
  const blocks: ContentBlock[] = [];
  
  // Regex to match cache sections: !___ CACHE:name ___! content !___ END-CACHE ___!
  const cacheRegex = /!___ CACHE:([\w-]+) ___!([\s\S]*?)!___ END-CACHE ___!/g;
  
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  while ((match = cacheRegex.exec(processed)) !== null) {
    const [fullMatch, sectionName, content] = match;
    const matchStart = match.index;
    
    // Add any text before this cache section as a regular block
    if (matchStart > lastIndex) {
      const beforeText = processed.slice(lastIndex, matchStart).trim();
      if (beforeText) {
        blocks.push({
          type: "text",
          text: beforeText,
        });
      }
    }
    
    // Add the cached section with cache_control marker
    blocks.push({
      type: "text",
      text: content.trim(),
      cache_control: { type: "ephemeral" },
    });
    
    lastIndex = matchStart + fullMatch.length;
  }
  
  // Add any remaining text after the last cache section
  if (lastIndex < processed.length) {
    const afterText = processed.slice(lastIndex).trim();
    if (afterText) {
      blocks.push({
        type: "text",
        text: afterText,
      });
    }
  }
  
  return {
    content: blocks,
    hasCacheMarkers: true,
  };
}

/**
 * Create a SystemMessage with cache-enabled content blocks
 * 
 * @param template - Template string with cache markers
 * @param variables - Variables to substitute
 * @returns SystemMessage with properly structured content
 */
export function createCachedSystemMessage(
  template: string,
  variables: Record<string, string> = {}
): SystemMessage {
  const processed = processCachedTemplate(template, variables);
  
  if (!processed.hasCacheMarkers) {
    // Simple string content for templates without cache markers
    return new SystemMessage(processed.content[0].text);
  }
  
  // Use content blocks for cache-enabled messages
  // In v1.x, SystemMessage accepts content array directly or as a string
  // Convert content blocks to the format expected by SystemMessage
  const contentBlocks = processed.content.map(block => ({
    type: block.type,
    text: block.text,
    ...(block.cache_control && { cache_control: block.cache_control })
  }));
  return new SystemMessage(contentBlocks as any);
}

/**
 * Estimate token count for a text block (rough approximation)
 * Claude uses ~4 chars per token on average
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Validate that cached sections meet minimum token requirements
 * Cached sections should be >= 1024 tokens for efficiency
 * 
 * @param template - Template to validate
 * @returns Validation results with warnings
 */
export function validateCacheSections(template: string): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  const cacheRegex = /!___ CACHE:([\w-]+) ___!([\s\S]*?)!___ END-CACHE ___!/g;
  
  let match: RegExpExecArray | null;
  while ((match = cacheRegex.exec(template)) !== null) {
    const [, sectionName, content] = match;
    const tokens = estimateTokens(content);
    
    if (tokens < 1024) {
      warnings.push(
        `Cache section "${sectionName}" is ~${tokens} tokens (minimum 1024 recommended for caching efficiency)`
      );
    }
  }
  
  return {
    valid: warnings.length === 0,
    warnings,
  };
}
