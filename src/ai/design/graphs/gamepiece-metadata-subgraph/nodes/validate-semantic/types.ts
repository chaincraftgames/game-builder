/**
 * Type definitions for gamepiece metadata validation.
 */

// TODO: Generate these from the JSON Schema or import from shared types
export interface GamepieceMetadata {
  gamepieceTypes?: Array<{
    id: string;
    type: string;
    template?: any;
    // ... other fields
  }>;
  gamepieceInstances?: Array<{
    id: string;
    typeId: string;
    // ... other fields
  }>;
  gamepieceInventories?: Array<{
    id: string;
    contents?: any[];
    // ... other fields
  }>;
}
