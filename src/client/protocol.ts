/**
 * Contrat réseau côté client (Brique 5).
 *
 * Miroir léger et autonome du protocole serveur (src/network/protocol.ts) :
 * uniquement les formes JSON échangées sur le fil. On évite ainsi de compiler
 * le code serveur (Node) dans le bundle navigateur. Toute évolution du
 * protocole doit être répercutée des deux côtés.
 */

export const ClientMessageType = {
  Connect: "CONNECT",
  Move: "MOVE",
  GainXpDebug: "GAIN_XP_DEBUG",
  AttackMob: "ATTACK_MOB",
  PickupLoot: "PICKUP_LOOT",
  InfuseWeapon: "INFUSE_WEAPON",
  CastSpell: "CAST_SPELL",
} as const;

/** Types de matériaux (Brique 9). */
export const MaterialType = {
  GriffeChauveSouris: "GRIFFE_CHAUVE_SOURIS",
  CaillouBrillant: "CAILLOU_BRILLANT",
} as const;

/** Rangs de portail (couleurs de rendu côté client). */
export type PortalRank = "C" | "B" | "A" | "S";

export const ServerMessageType = {
  PlayerState: "PLAYER_STATE",
  WorldUpdate: "WORLD_UPDATE",
  Error: "ERROR",
} as const;

// --- Formes de données (wire format) ---

export interface Position {
  x: number;
  y: number;
  zone: string;
}

export interface Affix {
  id: string;
  code: string;
  label: string;
  rarity: string;
  power: number;
}

export interface Spell {
  id: string;
  name: string;
  requiredType: string;
  unlockLevel: number;
  cost: number;
  cooldownMs: number;
}

export interface WeaponView {
  id: string;
  name: string;
  type: string;
  progression: { level: number; currentXp: number; nextLevelXp: number };
  rawStats: Record<string, number>;
  affixes: Affix[];
  generatedSpells: Spell[];
}

export interface PlayerView {
  id: string;
  pseudo: string;
  pk: boolean;
  pvBase: number;
  pvActuels: number;
  pmBase: number;
  pmActuels: number;
  position: Position;
  equipment: { slotPrincipal: string | null; slotSecondaire: string | null };
  materials: Record<string, number>;
  cooldownEndTimestamps: Record<string, number>;
}

export interface PublicLoot {
  id: string;
  materialType: string;
  amount: number;
  position: { x: number; y: number };
}

export interface AggregatedStatsView {
  rawStats: Record<string, number>;
  pvMax: number;
  pmMax: number;
  activeAffixes: Affix[];
  usableSpells: Spell[];
}

// --- Intentions Client -> Serveur ---

export type ClientMessage =
  | { type: typeof ClientMessageType.Connect; pseudo: string }
  | {
      type: typeof ClientMessageType.Move;
      sequenceNumber: number;
      dirX: number;
      dirY: number;
      deltaMs: number;
    }
  | { type: typeof ClientMessageType.GainXpDebug; amount: number }
  | { type: typeof ClientMessageType.AttackMob; mobId: string }
  | { type: typeof ClientMessageType.PickupLoot; lootId: string }
  | { type: typeof ClientMessageType.InfuseWeapon; materialType: string }
  | {
      type: typeof ClientMessageType.CastSpell;
      spellId: string;
      targetMobId?: string;
    };

export interface PublicPortal {
  id: string;
  rank: PortalRank;
  position: { x: number; y: number };
  open: boolean;
}

export interface PublicMonster {
  id: string;
  rank: PortalRank;
  pvActuels: number;
  pvMax: number;
  position: { x: number; y: number };
}

// --- États Serveur -> Client ---

export interface PlayerStateMessage {
  type: typeof ServerMessageType.PlayerState;
  player: PlayerView;
  stats: AggregatedStatsView;
  weapons: {
    slotPrincipal: WeaponView | null;
    slotSecondaire: WeaponView | null;
  };
  lastProcessedSequence: number;
}

export interface WorldUpdateMessage {
  type: typeof ServerMessageType.WorldUpdate;
  players: { id: string; pseudo: string; position: Position }[];
  portals: PublicPortal[];
  monsters: PublicMonster[];
  loots: PublicLoot[];
}

export interface ErrorMessage {
  type: typeof ServerMessageType.Error;
  code: string;
  message: string;
}

export type ServerMessage =
  | PlayerStateMessage
  | WorldUpdateMessage
  | ErrorMessage;
