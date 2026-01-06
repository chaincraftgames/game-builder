/**
 * Tests for prompt template processor with cache support
 */

import {
  processCachedTemplate,
  createCachedSystemMessage,
  validateCacheSections,
  estimateTokens,
} from "../prompt-template-processor.js";
import { SystemMessage } from "@langchain/core/messages";

describe("Prompt Template Processor", () => {
  describe("processCachedTemplate", () => {
    test("should process template without cache markers", () => {
      const template = "You are a helpful assistant.\n\nUser question: {question}";
      const result = processCachedTemplate(template, { question: "What is AI?" });

      expect(result.hasCacheMarkers).toBe(false);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe("You are a helpful assistant.\n\nUser question: What is AI?");
      expect(result.content[0].cache_control).toBeUndefined();
    });

    test("should process template with single cache section", () => {
      const template = `!___ CACHE:guidelines ___!
You are a helpful assistant.
Follow these rules:
- Be concise
- Be accurate
!___ END-CACHE ___!

User question: {question}`;

      const result = processCachedTemplate(template, { question: "What is AI?" });

      expect(result.hasCacheMarkers).toBe(true);
      expect(result.content).toHaveLength(2);
      
      // First block: cached guidelines
      expect(result.content[0].text).toContain("You are a helpful assistant");
      expect(result.content[0].cache_control).toEqual({ type: "ephemeral" });
      
      // Second block: dynamic content
      expect(result.content[1].text).toContain("User question: What is AI?");
      expect(result.content[1].cache_control).toBeUndefined();
    });

    test("should process template with multiple cache sections", () => {
      const template = `!___ CACHE:intro ___!
You are a game designer.
!___ END-CACHE ___!

Current game: {gameName}

!___ CACHE:examples ___!
Example designs:
1. Chess
2. Checkers
!___ END-CACHE ___!

Please design the game.`;

      const result = processCachedTemplate(template, { gameName: "Poker" });

      expect(result.hasCacheMarkers).toBe(true);
      expect(result.content).toHaveLength(4);
      
      // First cached section
      expect(result.content[0].text).toContain("game designer");
      expect(result.content[0].cache_control).toEqual({ type: "ephemeral" });
      
      // Dynamic content
      expect(result.content[1].text).toContain("Current game: Poker");
      expect(result.content[1].cache_control).toBeUndefined();
      
      // Second cached section
      expect(result.content[2].text).toContain("Example designs");
      expect(result.content[2].cache_control).toEqual({ type: "ephemeral" });
      
      // Final dynamic content
      expect(result.content[3].text).toContain("Please design the game");
      expect(result.content[3].cache_control).toBeUndefined();
    });

    test("should handle variables in cached sections", () => {
      const template = `!___ CACHE:static ___!
Model version: {version}
Guidelines: Be helpful
!___ END-CACHE ___!

Query: {query}`;

      const result = processCachedTemplate(template, {
        version: "v1.0",
        query: "Hello",
      });

      expect(result.content[0].text).toContain("Model version: v1.0");
      expect(result.content[1].text).toContain("Query: Hello");
    });
  });

  describe("createCachedSystemMessage", () => {
    test("should create simple SystemMessage without cache markers", () => {
      const template = "You are helpful. Answer: {answer}";
      const message = createCachedSystemMessage(template, { answer: "42" });

      expect(message).toBeInstanceOf(SystemMessage);
      expect(message.content).toBe("You are helpful. Answer: 42");
    });

    test("should create SystemMessage with content blocks for cached template", () => {
      const template = `!___ CACHE:rules ___!
Follow these rules
!___ END-CACHE ___!

Question: {question}`;

      const message = createCachedSystemMessage(template, { question: "What?" });

      expect(message).toBeInstanceOf(SystemMessage);
      expect(typeof message.content).toBe("object");
      expect(Array.isArray(message.content)).toBe(true);
      
      const content = message.content as any[];
      expect(content).toHaveLength(2);
      expect(content[0].cache_control).toEqual({ type: "ephemeral" });
    });
  });

  describe("estimateTokens", () => {
    test("should estimate tokens correctly", () => {
      expect(estimateTokens("test")).toBe(1); // 4 chars = 1 token
      expect(estimateTokens("hello world")).toBe(3); // 11 chars = ~3 tokens
      expect(estimateTokens("a".repeat(4096))).toBe(1024); // 4096 chars = 1024 tokens
    });
  });

  describe("validateCacheSections", () => {
    test("should warn for small cache sections", () => {
      const template = `!___ CACHE:tiny ___!
Small section
!___ END-CACHE ___!`;

      const result = validateCacheSections(template);
      
      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("tiny");
      expect(result.warnings[0]).toContain("1024");
    });

    test("should validate large cache sections", () => {
      const largeContent = "x".repeat(4096); // ~1024 tokens
      const template = `!___ CACHE:large ___!
${largeContent}
!___ END-CACHE ___!`;

      const result = validateCacheSections(template);
      
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test("should validate multiple sections", () => {
      const template = `!___ CACHE:small1 ___!
Tiny
!___ END-CACHE ___!

!___ CACHE:large ___!
${"x".repeat(5000)}
!___ END-CACHE ___!

!___ CACHE:small2 ___!
Also tiny
!___ END-CACHE ___!`;

      const result = validateCacheSections(template);
      
      expect(result.valid).toBe(false);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings.some(w => w.includes("small1"))).toBe(true);
      expect(result.warnings.some(w => w.includes("small2"))).toBe(true);
    });
  });
});
