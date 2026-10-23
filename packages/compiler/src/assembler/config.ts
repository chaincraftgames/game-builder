// ---------------------------------------------------------------------------
// assembleConfig — spec modules → GameConfig
//
// Pure mapping from the validated ModularGameSpec's static-data modules
// (metadata, state, gamepieceTypes, inventories, players) into the
// runtime's immutable GameConfig shape. No piece instantiation here —
// see state.ts for that.
// ---------------------------------------------------------------------------

import type { ModularGameSpec, PropertyType, StatePropertySchema } from '@chaincraft/gamedef';
import { z } from 'zod';
import { ELIMINATED_PROPERTY } from '@chaincraft/runtime';
import type { GamepiecePropertyConfig } from '@chaincraft/runtime';
import type {
  GameConfig,
  GamepieceTypeConfig,
  InventoryConfig,
  PropertyConfig,
  RefType,
} from './types.js';
import { UNASSIGNED_INVENTORY_ID } from './types.js';

type StateProperty = z.infer<typeof StatePropertySchema>;

/**
 * Map a gamedef PropertyType (discriminated union) to the runtime's flat
 * PropertyConfig fields (min/max/enumValues/refType).
 */
function mapPropertyType(type: PropertyType): Pick<PropertyConfig, 'min' | 'max' | 'enumValues' | 'refType'> {
  switch (type.kind) {
    case 'number':
      return { min: type.min, max: type.max };
    case 'enum':
      return { enumValues: type.values };
    case 'player-id':
    case 'player-role-id':
    case 'gamepiece-id':
      return { refType: type.kind as RefType };
    case 'string':
    case 'boolean':
      return {};
  }
}

/** Map a state-module property (game or player scoped) to a PropertyConfig. */
function mapStateProperty(prop: StateProperty): PropertyConfig {
  const isComputed = prop.computed !== undefined;
  return {
    mutable: !isComputed,
    ...mapPropertyType(prop.type),
    ...(prop.computed ? { computed: prop.computed } : {}),
  };
}

function assembleGameProperties(spec: ModularGameSpec): Record<string, PropertyConfig> {
  const props = spec.state?.game?.properties ?? [];
  return Object.fromEntries(props.map((p) => [p.id, mapStateProperty(p)]));
}

function assemblePlayerProperties(spec: ModularGameSpec): Record<string, PropertyConfig> {
  const props = spec.state?.player?.properties ?? [];
  return {
    ...Object.fromEntries(props.map((p) => [p.id, mapStateProperty(p)])),
    [ELIMINATED_PROPERTY]: { mutable: true },
  };
}

function assembleGamepieceTypes(spec: ModularGameSpec): Record<string, GamepieceTypeConfig> {
  const types = spec.gamepieceTypes?.types ?? [];
  return Object.fromEntries(
    types.map((t) => {
      const properties = Object.fromEntries(
        (t.properties ?? []).map((p) => [
          p.id,
          {
            mutable: p.mutable,
            ...(p.visibility ? { visibility: p.visibility } : {}),
            ...mapPropertyType(p.type),
          } satisfies GamepiecePropertyConfig,
        ]),
      );
      // hasFaceState/exhaustible/orientationCount are Zod-defaulted (false/false/1)
      // on every parsed spec, even when the author omitted them. Those are no-op
      // values for the runtime (optional fields), so we omit them here to keep
      // the config lean and avoid asserting behavior the author never opted into.
      const config: GamepieceTypeConfig = {
        category: t.category,
        properties,
        ...(t.hasFaceState ? { hasFaceState: t.hasFaceState } : {}),
        ...(t.exhaustible ? { exhaustible: t.exhaustible } : {}),
        ...(t.faces !== undefined ? { faces: t.faces } : {}),
        ...(t.faceCount !== undefined
          ? { faces: Array.from({ length: t.faceCount }, (_, i) => i + 1) }
          : {}),
        ...(t.orientationCount !== 1 ? { orientationCount: t.orientationCount } : {}),
        ...(t.inventorySlots?.length ? { inventorySlots: t.inventorySlots.map((s) => s.id) } : {}),
      };
      return [t.id, config];
    }),
  );
}

function defaultCountVisibility(visibility: string): "always" | "owner" | "never" {
  return visibility === 'never' ? 'never' : 'always';
}

function assembleInventories(spec: ModularGameSpec): Record<string, InventoryConfig> {
  const types = spec.inventories?.types ?? [];
  return Object.fromEntries(
    types.map((inv) => {
      const config: InventoryConfig = {
        structure: inv.structure,
        scope: inv.scope.kind,
        visibility: inv.visibility,
        countVisibility: inv.countVisibility ?? defaultCountVisibility(inv.visibility),
        accepts: inv.accepts,
        ...(inv.capacity ? { capacity: inv.capacity } : {}),
        ...(inv.gridDimensions ? { gridDimensions: inv.gridDimensions } : {}),
        ...('role' in inv.scope && inv.scope.role ? { role: inv.scope.role } : {}),
      };
      return [inv.id, config];
    }),
  );
}

/** Reserved pool: hidden from every player, including its count. */
function assembleUnassignedInventory(spec: ModularGameSpec): InventoryConfig {
  return {
    structure: 'none',
    scope: 'game',
    visibility: 'never',
    countVisibility: 'never',
    accepts: (spec.gamepieceTypes?.types ?? []).map((t) => t.id),
  };
}

/**
 * Assemble the immutable GameConfig from a validated ModularGameSpec.
 */
export function assembleConfig(spec: ModularGameSpec): GameConfig {
  if (!spec.metadata) {
    throw new Error('assembleConfig: spec.metadata is required');
  }
  return {
    inventories: {
      ...assembleInventories(spec),
      [UNASSIGNED_INVENTORY_ID]: assembleUnassignedInventory(spec),
    },
    gamepieceTypes: assembleGamepieceTypes(spec),
    gameProperties: assembleGameProperties(spec),
    playerProperties: assemblePlayerProperties(spec),
    playerCount: spec.metadata.playerCount,
  };
}
