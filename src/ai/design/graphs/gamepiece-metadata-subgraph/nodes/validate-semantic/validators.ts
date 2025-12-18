/**
 * Semantic Validation Rules
 * 
 * Business rules for validating gamepiece metadata.
 */

import { GamepieceMetadata } from "./types.js";

export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Validates that all referenced types are defined.
 */
export function validateTypeReferences(metadata: GamepieceMetadata): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // TODO: Implement validation logic
  // 1. Collect all type IDs from gamepieceTypes
  // 2. Check each gamepieceInstance.typeId exists
  // 3. Check each inventory item references valid instances
  
  return errors;
}

/**
 * Validates inventory contents reference valid instances.
 */
export function validateInventoryContents(metadata: GamepieceMetadata): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // TODO: Implement validation logic
  
  return errors;
}

/**
 * Validates template parameters are valid.
 */
export function validateTemplates(metadata: GamepieceMetadata): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // TODO: Implement validation logic
  
  return errors;
}

/**
 * Validates no orphaned instances or inventories exist.
 */
export function validateNoOrphans(metadata: GamepieceMetadata): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // TODO: Implement validation logic
  
  return errors;
}

/**
 * Runs all semantic validation rules.
 */
export function runAllValidations(metadata: GamepieceMetadata): ValidationError[] {
  return [
    ...validateTypeReferences(metadata),
    ...validateInventoryContents(metadata),
    ...validateTemplates(metadata),
    ...validateNoOrphans(metadata)
  ];
}
