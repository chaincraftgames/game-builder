/**
 * Type definitions for metadata completeness review.
 */

/**
 * Gap in metadata coverage (missing categories, archetypes, etc.)
 */
export interface MetadataGap {
  category: string;                          // e.g., "defensive creatures", "healing items"
  severity: "critical" | "major" | "minor";  // How important this gap is
  description: string;                       // Explanation of what's missing
  suggestedCount?: number;                   // How many instances would fill this gap
}

/**
 * Balance issue in metadata (power creep, theme inconsistency, etc.)
 */
export interface MetadataBalanceIssue {
  type: "power_level" | "theme_distribution" | "rarity_distribution" | "mechanic_variety" | "other";
  description: string;                       // What's imbalanced
  examples: string[];                        // Instance IDs showing the issue
  severity: "critical" | "major" | "minor";
}

/**
 * Quality assessment for a single instance
 */
export interface InstanceQualityAssessment {
  instanceId: string;
  isQualityUnique: boolean;    // Non-redundant with adequate description
  issues: string[];            // Specific problems (generic name, duplicate theme, etc.)
}

/**
 * Comprehensive metadata review score
 */
export interface MetadataReviewScore {
  // What's required by spec
  required: {
    totalInstances: number;    // Sum of all gamepieceType.quantity values
    uniqueTypes: number;       // Number of distinct gamepiece types
  };
  
  // What actually exists
  actual: {
    totalInstances: number;             // Count of instances created
    qualityUniqueInstances: number;     // Count of non-redundant, well-described instances
  };
  
  // Analysis of what's missing
  gaps: MetadataGap[];
  
  // Analysis of balance issues
  balanceIssues: MetadataBalanceIssue[];
  
  // Per-instance quality assessment (for debugging)
  instanceQuality: InstanceQualityAssessment[];
  
  // Overall completion metrics
  isComplete: boolean;                    // true when actual >= required AND no critical gaps/issues
  completionPercentage: number;           // actual.qualityUniqueInstances / required.totalInstances (0-100)
  needsRefinement: boolean;               // !isComplete
  
  // Guidance for next iteration
  suggestions: string[];                  // Actionable recommendations
  iterationPriority: "add_instances" | "improve_quality" | "fix_balance" | "complete";
}

/**
 * Configuration for review scoring thresholds
 */
export interface ReviewScoringConfig {
  minCompletionPercentage?: number;       // Default: 95 (allow 95%+ to pass)
  allowMinorGaps?: boolean;               // Default: true (ignore "minor" severity gaps)
  allowMinorBalanceIssues?: boolean;      // Default: true (ignore "minor" severity balance issues)
  qualityThresholds?: {
    minDescriptionLength?: number;        // Default: 15 chars
    maxSimilarityScore?: number;          // Default: 0.8 (0-1, lower = more unique)
  };
}
