/**
 * Scoring functions for metadata completeness review.
 * 
 * Pure TypeScript, deterministic - no LLM calls.
 */

import {
  MetadataReviewScore,
  MetadataGap,
  MetadataBalanceIssue,
  InstanceQualityAssessment,
  ReviewScoringConfig,
} from "./types.js";

const DEFAULT_CONFIG: Required<ReviewScoringConfig> = {
  minCompletionPercentage: 95,
  allowMinorGaps: true,
  allowMinorBalanceIssues: true,
  qualityThresholds: {
    minDescriptionLength: 15,
    maxSimilarityScore: 0.8,
  },
};

type MetadataType = {
  gamepieceTypes?: Array<any>;
  gamepieceInstances?: Array<any>;
  gamepieceInventories?: Array<any>;
};

/**
 * Calculate required instance counts from metadata types
 */
function calculateRequired(metadata: MetadataType): {
  totalInstances: number;
  uniqueTypes: number;
} {
  if (!metadata?.gamepieceTypes?.length) {
    return { totalInstances: 0, uniqueTypes: 0 };
  }
  
  const totalInstances = metadata.gamepieceTypes.reduce(
    (sum: number, type: any) => sum + (type.quantity || 0),
    0
  );
  
  return {
    totalInstances,
    uniqueTypes: metadata.gamepieceTypes.length,
  };
}

/**
 * Calculate actual instance counts from metadata
 */
function calculateActual(metadata: MetadataType): {
  totalInstances: number;
  qualityUniqueInstances: number;
} {
  if (!metadata?.gamepieceInstances?.length) {
    return { totalInstances: 0, qualityUniqueInstances: 0 };
  }
  
  return {
    totalInstances: metadata.gamepieceInstances.length,
    qualityUniqueInstances: 0, // Calculated by assessInstanceQuality
  };
}

/**
 * Assess quality of individual instances
 */
export function assessInstanceQuality(
  metadata: MetadataType,
  config: ReviewScoringConfig = {}
): InstanceQualityAssessment[] {
  const cfg = { ...DEFAULT_CONFIG, ...config, qualityThresholds: { ...DEFAULT_CONFIG.qualityThresholds, ...config.qualityThresholds } };
  
  if (!metadata?.gamepieceInstances?.length) {
    return [];
  }
  
  const assessments: InstanceQualityAssessment[] = [];
  const instances = metadata.gamepieceInstances;
  
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    const issues: string[] = [];
    
    // Check 1: Has adequate description
    const description = instance.brief_description || instance.description || "";
    if (cfg.qualityThresholds.minDescriptionLength && description.length < cfg.qualityThresholds.minDescriptionLength) {
      issues.push(`Description too short (${description.length} chars, min ${cfg.qualityThresholds.minDescriptionLength})`);
    }
    
    // Check 2: Name is not generic/placeholder
    const name = instance.name || "";
    if (/^(gamepiece|instance|token|card|creature|item)_?\d+$/i.test(name)) {
      issues.push("Generic placeholder name");
    }
    
    // Check 3: Description is not duplicated or too similar to others
    for (let j = 0; j < i; j++) {
      const otherInstance = instances[j];
      const otherDescription = otherInstance.brief_description || otherInstance.description || "";
      
      if (description === otherDescription && description.length > 0) {
        issues.push(`Duplicate description (same as ${otherInstance.id || otherInstance.name})`);
        break;
      }
      
      // Simple similarity check: shared word ratio
      const similarity = calculateSimpleSimilarity(description, otherDescription);
      if (cfg.qualityThresholds.maxSimilarityScore && similarity > cfg.qualityThresholds.maxSimilarityScore) {
        issues.push(`Very similar to ${otherInstance.id || otherInstance.name} (${Math.round(similarity * 100)}% similar)`);
        break;
      }
    }
    
    assessments.push({
      instanceId: instance.id || instance.name || `instance_${i}`,
      isQualityUnique: issues.length === 0,
      issues,
    });
  }
  
  return assessments;
}

/**
 * Simple word-based similarity score (0-1, higher = more similar)
 */
function calculateSimpleSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Detect gaps in metadata coverage
 * 
 * Analyzes instance distribution across categories/themes/mechanics.
 * For game-specific analysis (attack vs defense), would need domain knowledge.
 * This is a simplified heuristic version.
 */
export function detectGaps(
  metadata: MetadataType,
  required: { totalInstances: number }
): MetadataGap[] {
  const gaps: MetadataGap[] = [];
  
  if (!metadata?.gamepieceTypes?.length) {
    return gaps;
  }
  
  // Check each type for completeness
  for (const type of metadata.gamepieceTypes) {
    const requiredQuantity = type.quantity || 0;
    const instances = metadata.gamepieceInstances?.filter(
      (inst: any) => inst.type_id === type.id
    ) || [];
    const actualQuantity = instances.length;
    
    if (actualQuantity === 0 && requiredQuantity > 0) {
      gaps.push({
        category: type.name || type.id,
        severity: "critical",
        description: `No instances created for ${type.name || type.id} (need ${requiredQuantity})`,
        suggestedCount: requiredQuantity,
      });
    } else if (actualQuantity < requiredQuantity * 0.5) {
      gaps.push({
        category: type.name || type.id,
        severity: "major",
        description: `Only ${actualQuantity}/${requiredQuantity} instances for ${type.name || type.id}`,
        suggestedCount: requiredQuantity - actualQuantity,
      });
    } else if (actualQuantity < requiredQuantity) {
      gaps.push({
        category: type.name || type.id,
        severity: "minor",
        description: `${actualQuantity}/${requiredQuantity} instances for ${type.name || type.id}`,
        suggestedCount: requiredQuantity - actualQuantity,
      });
    }
  }
  
  return gaps;
}

/**
 * Detect balance issues in metadata
 * 
 * Checks for:
 * - Theme/category distribution (all fire, no water)
 * - Description homogeneity (all similar descriptions)
 * - Name patterns (creature_1, creature_2, ... = poor quality)
 */
export function detectBalanceIssues(
  metadata: MetadataType,
  instanceQuality: InstanceQualityAssessment[]
): MetadataBalanceIssue[] {
  const issues: MetadataBalanceIssue[] = [];
  
  if (!metadata?.gamepieceInstances?.length) {
    return issues;
  }
  
  const instances = metadata.gamepieceInstances;
  
  // Issue 1: Too many low-quality instances
  const lowQualityCount = instanceQuality.filter(q => !q.isQualityUnique).length;
  const lowQualityPercentage = (lowQualityCount / instances.length) * 100;
  
  if (lowQualityPercentage > 30) {
    issues.push({
      type: "other",
      description: `${lowQualityPercentage.toFixed(1)}% of instances have quality issues (generic names, duplicate descriptions)`,
      examples: instanceQuality
        .filter(q => !q.isQualityUnique)
        .slice(0, 5)
        .map(q => `${q.instanceId}: ${q.issues[0]}`),
      severity: lowQualityPercentage > 50 ? "critical" : "major",
    });
  }
  
  // Issue 2: Theme distribution (extract keywords from descriptions)
  const themeKeywords = extractThemeKeywords(instances);
  const dominantTheme = findDominantTheme(themeKeywords);
  
  if (dominantTheme && dominantTheme.percentage > 60 && instances.length > 10) {
    issues.push({
      type: "theme_distribution",
      description: `${dominantTheme.percentage.toFixed(1)}% of instances share "${dominantTheme.theme}" theme, lack variety`,
      examples: dominantTheme.instances.slice(0, 3),
      severity: dominantTheme.percentage > 80 ? "major" : "minor",
    });
  }
  
  return issues;
}

/**
 * Extract theme keywords from instance descriptions
 */
function extractThemeKeywords(instances: any[]): Map<string, string[]> {
  const themeWords = ["fire", "ice", "water", "earth", "wind", "light", "dark", "shadow", "lightning", "nature", "poison", "holy", "demon", "dragon", "beast", "undead"];
  const themes = new Map<string, string[]>();
  
  for (const instance of instances) {
    const description = (instance.brief_description || instance.description || "").toLowerCase();
    const name = (instance.name || "").toLowerCase();
    const text = `${name} ${description}`;
    
    for (const theme of themeWords) {
      if (text.includes(theme)) {
        if (!themes.has(theme)) {
          themes.set(theme, []);
        }
        themes.get(theme)!.push(instance.id || instance.name || "unknown");
      }
    }
  }
  
  return themes;
}

/**
 * Find dominant theme if one exists
 */
function findDominantTheme(themeKeywords: Map<string, string[]>): {
  theme: string;
  percentage: number;
  instances: string[];
} | null {
  if (themeKeywords.size === 0) return null;
  
  let maxTheme = "";
  let maxCount = 0;
  
  for (const [theme, instances] of themeKeywords.entries()) {
    if (instances.length > maxCount) {
      maxCount = instances.length;
      maxTheme = theme;
    }
  }
  
  if (maxCount === 0) return null;
  
  return {
    theme: maxTheme,
    percentage: maxCount, // Will be converted to percentage by caller
    instances: themeKeywords.get(maxTheme) || [],
  };
}

/**
 * Generate actionable suggestions based on review results
 */
export function generateSuggestions(
  gaps: MetadataGap[],
  balanceIssues: MetadataBalanceIssue[],
  actual: { qualityUniqueInstances: number },
  required: { totalInstances: number }
): string[] {
  const suggestions: string[] = [];
  
  // Critical gaps first
  const criticalGaps = gaps.filter(g => g.severity === "critical");
  if (criticalGaps.length > 0) {
    for (const gap of criticalGaps) {
      suggestions.push(`CRITICAL: ${gap.description} - add ${gap.suggestedCount} instances`);
    }
  }
  
  // Major gaps
  const majorGaps = gaps.filter(g => g.severity === "major");
  if (majorGaps.length > 0) {
    for (const gap of majorGaps) {
      suggestions.push(`Add ${gap.suggestedCount} more instances for ${gap.category}`);
    }
  }
  
  // Balance issues
  const criticalBalance = balanceIssues.filter(b => b.severity === "critical");
  if (criticalBalance.length > 0) {
    for (const issue of criticalBalance) {
      suggestions.push(`Fix balance issue: ${issue.description}`);
    }
  }
  
  // Quality improvements
  const remaining = required.totalInstances - actual.qualityUniqueInstances;
  if (remaining > 0 && gaps.length === 0) {
    suggestions.push(`Improve quality of ${remaining} instances (fix generic names, enhance descriptions)`);
  }
  
  // Minor gaps and balance issues
  if (suggestions.length === 0) {
    const minorGaps = gaps.filter(g => g.severity === "minor");
    if (minorGaps.length > 0) {
      suggestions.push(`Minor: Add ${minorGaps.reduce((sum, g) => sum + (g.suggestedCount || 0), 0)} more instances to reach 100% completion`);
    }
    
    const minorBalance = balanceIssues.filter(b => b.severity === "minor");
    if (minorBalance.length > 0) {
      suggestions.push(`Consider: ${minorBalance[0].description}`);
    }
  }
  
  return suggestions;
}

/**
 * Determine iteration priority based on review results
 */
export function determineIterationPriority(
  completionPercentage: number,
  gaps: MetadataGap[],
  balanceIssues: MetadataBalanceIssue[],
  instanceQuality: InstanceQualityAssessment[]
): MetadataReviewScore["iterationPriority"] {
  // If we have critical gaps, adding instances is priority
  if (gaps.some(g => g.severity === "critical")) {
    return "add_instances";
  }
  
  // If completion is low (<50%), need more instances
  if (completionPercentage < 50) {
    return "add_instances";
  }
  
  // If we have critical balance issues, fix those
  if (balanceIssues.some(b => b.severity === "critical")) {
    return "fix_balance";
  }
  
  // If completion is high but quality is low, improve quality
  const lowQualityPercentage = (instanceQuality.filter(q => !q.isQualityUnique).length / instanceQuality.length) * 100;
  if (completionPercentage >= 80 && lowQualityPercentage > 30) {
    return "improve_quality";
  }
  
  // If we're close (90%+) and no major issues, we're complete
  if (completionPercentage >= 90 && !gaps.some(g => g.severity === "major") && !balanceIssues.some(b => b.severity === "major")) {
    return "complete";
  }
  
  // Default: add more instances
  return "add_instances";
}

/**
 * Main scoring function - combines all assessments
 */
export function scoreMetadataCompleteness(
  metadata: MetadataType,
  config: ReviewScoringConfig = {}
): MetadataReviewScore {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  
  // Calculate requirements
  const required = calculateRequired(metadata);
  const actual = calculateActual(metadata);
  
  // Assess instance quality
  const instanceQuality = assessInstanceQuality(metadata, config);
  const qualityUniqueInstances = instanceQuality.filter(q => q.isQualityUnique).length;
  actual.qualityUniqueInstances = qualityUniqueInstances;
  
  // Detect gaps and balance issues
  const gaps = detectGaps(metadata, required);
  const balanceIssues = detectBalanceIssues(metadata, instanceQuality);
  
  // Calculate completion percentage
  const completionPercentage = required.totalInstances > 0
    ? Math.min(100, (qualityUniqueInstances / required.totalInstances) * 100)
    : 0;
  
  // Determine if complete
  const criticalGaps = gaps.filter(g => g.severity === "critical");
  const majorGaps = cfg.allowMinorGaps ? gaps.filter(g => g.severity === "major") : gaps.filter(g => g.severity !== "minor");
  const criticalBalance = balanceIssues.filter(b => b.severity === "critical");
  const majorBalance = cfg.allowMinorBalanceIssues ? balanceIssues.filter(b => b.severity === "major") : balanceIssues.filter(b => b.severity !== "minor");
  
  const isComplete = 
    completionPercentage >= cfg.minCompletionPercentage &&
    criticalGaps.length === 0 &&
    majorGaps.length === 0 &&
    criticalBalance.length === 0 &&
    majorBalance.length === 0;
  
  // Generate suggestions
  const suggestions = generateSuggestions(gaps, balanceIssues, actual, required);
  
  // Determine priority
  const iterationPriority = determineIterationPriority(
    completionPercentage,
    gaps,
    balanceIssues,
    instanceQuality
  );
  
  return {
    required,
    actual,
    gaps,
    balanceIssues,
    instanceQuality,
    isComplete,
    completionPercentage,
    needsRefinement: !isComplete,
    suggestions,
    iterationPriority,
  };
}
