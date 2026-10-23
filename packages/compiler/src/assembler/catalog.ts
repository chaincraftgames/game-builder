// ---------------------------------------------------------------------------
// Catalog piece-ID enumeration — single source of truth.
//
// Rules:
//   Named entry (id set, quantity === 1) → uses entry.id directly.
//   All others → '${typeId}-${n}' with a per-type counter that increments
//   across ALL catalog entries in declaration order (not just matching ones).
//
// Both the state assembler (building Gamepiece records) and the passives
// assembler (binding passiveActivations to piece IDs) consume this so the
// ID scheme can only be defined and changed in one place.
// ---------------------------------------------------------------------------

import type { ModularGameSpec, CatalogEntry } from "@chaincraft/gamedef";

export interface CatalogPieceEntry {
  entry: CatalogEntry;
  pieceIds: string[];
}

/** Enumerate every piece instance in catalog declaration order with its assigned ID(s). */
export function enumerateCatalogPieces(
  spec: ModularGameSpec,
): CatalogPieceEntry[] {
  const entries = spec.catalog?.entries ?? [];
  const counters: Record<string, number> = {};
  const result: CatalogPieceEntry[] = [];

  for (const entry of entries) {
    const quantity = entry.quantity ?? 1;
    const pieceIds: string[] = [];

    for (let i = 0; i < quantity; i++) {
      let id: string;
      if (entry.id && quantity === 1) {
        id = entry.id;
      } else {
        const next = (counters[entry.typeId] ?? 0) + 1;
        counters[entry.typeId] = next;
        id = `${entry.typeId}-${next}`;
      }
      pieceIds.push(id);
    }

    result.push({ entry, pieceIds });
  }

  return result;
}
