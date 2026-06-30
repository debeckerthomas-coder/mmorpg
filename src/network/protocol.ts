import type { AggregatedStats } from "../models/stats.js";
import type { Player } from "../models/player.js";
import type { Weapon } from "../models/weapon.js";
import type { Point2D, PortalRank } from "../models/portals.js";

/**
 * Protocole réseau du serveur autoritaire.
 *
 * Toute la communication transite en JSON via WebSocket. Deux familles de
 * messages, chacune discriminée par un champ `type` :
 *   - `ClientMessage` : INTENTIONS Client -> Serveur (jamais des ordres).
 *   - `ServerMessage` : ÉTATS Serveur -> Client (l'autorité fait foi).
 *
 * Principe serveur autoritaire : le client n'envoie qu'une *envie* d'agir
 * (« je veux me déplacer ici »). Le serveur valide, applique (ou rejette) et
 * renvoie l'état officiel. Le client ne modifie jamais l'état directement.
 */

// ---------------------------------------------------------------------------
// Intentions : Client -> Serveur
// ---------------------------------------------------------------------------

export const ClientMessageType = {
  Connect: "CONNECT",
  Move: "MOVE",
  GainXpDebug: "GAIN_XP_DEBUG",
  AttackMob: "ATTACK_MOB",
  PickupLoot: "PICKUP_LOOT",
  InfuseWeapon: "INFUSE_WEAPON",
  CastSpell: "CAST_SPELL",
} as const;

export type ClientMessageType =
  (typeof ClientMessageType)[keyof typeof ClientMessageType];

/** Le joueur demande à rejoindre la partie avec son pseudo. */
export interface ConnectMessage {
  type: typeof ClientMessageType.Connect;
  pseudo: string;
}

/**
 * Intention de déplacement fluide (prédiction réseau) : un vecteur de
 * direction + le delta-time de la frame, accompagnés d'un numéro de séquence
 * unique pour la réconciliation côté client.
 */
export interface MoveMessage {
  type: typeof ClientMessageType.Move;
  sequenceNumber: number;
  dirX: number;
  dirY: number;
  deltaMs: number;
}

/** Commande de debug : force l'arme du Slot_Principal à gagner de l'XP. */
export interface GainXpDebugMessage {
  type: typeof ClientMessageType.GainXpDebug;
  amount: number;
}

/** Le joueur attaque un monstre (validé en portée par le serveur). */
export interface AttackMobMessage {
  type: typeof ClientMessageType.AttackMob;
  mobId: string;
}

/** Le joueur ramasse un loot au sol (validé en portée par le serveur). */
export interface PickupLootMessage {
  type: typeof ClientMessageType.PickupLoot;
  lootId: string;
}

/** Le joueur infuse son arme avec un matériau (Brique 9). */
export interface InfuseWeaponMessage {
  type: typeof ClientMessageType.InfuseWeapon;
  materialType: string;
}

/** Le joueur lance un sort actif (Brique 10). `targetMobId` optionnel. */
export interface CastSpellMessage {
  type: typeof ClientMessageType.CastSpell;
  spellId: string;
  targetMobId?: string;
}

export type ClientMessage =
  | ConnectMessage
  | MoveMessage
  | GainXpDebugMessage
  | AttackMobMessage
  | PickupLootMessage
  | InfuseWeaponMessage
  | CastSpellMessage;

// ---------------------------------------------------------------------------
// États / réponses : Serveur -> Client
// ---------------------------------------------------------------------------

export const ServerMessageType = {
  PlayerState: "PLAYER_STATE",
  WorldUpdate: "WORLD_UPDATE",
  Error: "ERROR",
} as const;

export type ServerMessageType =
  (typeof ServerMessageType)[keyof typeof ServerMessageType];

/** Vue publique d'un joueur diffusée aux autres (sans données sensibles). */
export interface PublicPlayer {
  id: string;
  pseudo: string;
  position: Player["position"];
}

/** Armes effectivement équipées dans les deux slots (résolues côté serveur). */
export interface EquippedWeapons {
  slotPrincipal: Weapon | null;
  slotSecondaire: Weapon | null;
}

/**
 * État complet du joueur connecté : son entité, ses statistiques agrégées
 * (règle d'agrégation de la Brique 1) et le détail des armes équipées (pour le
 * HUD : nom, niveau, XP, affixes, sorts).
 */
export interface PlayerStateMessage {
  type: typeof ServerMessageType.PlayerState;
  player: Player;
  stats: AggregatedStats;
  weapons: EquippedWeapons;
  /**
   * Dernier `sequenceNumber` de MOVE traité par le serveur (réconciliation).
   * 0 tant qu'aucun déplacement n'a été traité pour cette session.
   */
  lastProcessedSequence: number;
}

/** Vue publique d'un portail. */
export interface PublicPortal {
  id: string;
  rank: PortalRank;
  position: Point2D;
  open: boolean;
}

/** Vue publique d'un monstre (sans la cible interne ni l'XP). */
export interface PublicMonster {
  id: string;
  rank: PortalRank;
  pvActuels: number;
  pvMax: number;
  position: Point2D;
}

/** Vue publique d'un loot au sol (Brique 9). */
export interface PublicLoot {
  id: string;
  materialType: string;
  amount: number;
  position: Point2D;
}

/**
 * Diffusion de l'état du monde : joueurs présents, portails ouverts et
 * monstres actifs (Brique 6).
 */
export interface WorldUpdateMessage {
  type: typeof ServerMessageType.WorldUpdate;
  players: PublicPlayer[];
  portals: PublicPortal[];
  monsters: PublicMonster[];
  loots: PublicLoot[];
}

/** Erreur applicative (intention invalide, JSON malformé, etc.). */
export interface ErrorMessage {
  type: typeof ServerMessageType.Error;
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | PlayerStateMessage
  | WorldUpdateMessage
  | ErrorMessage;

export const ErrorCode = {
  MalformedJson: "MALFORMED_JSON",
  UnknownType: "UNKNOWN_TYPE",
  InvalidPayload: "INVALID_PAYLOAD",
  NotConnected: "NOT_CONNECTED",
  InvalidMove: "INVALID_MOVE",
  NoWeaponEquipped: "NO_WEAPON_EQUIPPED",
  MobNotFound: "MOB_NOT_FOUND",
  OutOfRange: "OUT_OF_RANGE",
  LootNotFound: "LOOT_NOT_FOUND",
  NotEnoughMaterials: "NOT_ENOUGH_MATERIALS",
  UnknownMaterial: "UNKNOWN_MATERIAL",
  SpellNotUsable: "SPELL_NOT_USABLE",
  NotEnoughMana: "NOT_ENOUGH_MANA",
  SpellOnCooldown: "SPELL_ON_COOLDOWN",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Parsing sécurisé
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: ErrorCode; reason: string };

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Parse et valide de façon défensive un message brut reçu du client.
 * Ne lève JAMAIS : renvoie un `ParseResult` que l'appelant traduit en réponse.
 */
export const parseClientMessage = (raw: string): ParseResult => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: ErrorCode.MalformedJson, reason: "JSON invalide" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      ok: false,
      code: ErrorCode.InvalidPayload,
      reason: "Le message doit être un objet",
    };
  }

  const obj = data as Record<string, unknown>;

  switch (obj["type"]) {
    case ClientMessageType.Connect: {
      if (typeof obj["pseudo"] !== "string" || obj["pseudo"].trim() === "") {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "CONNECT requiert un 'pseudo' non vide",
        };
      }
      return {
        ok: true,
        message: { type: ClientMessageType.Connect, pseudo: obj["pseudo"] },
      };
    }
    case ClientMessageType.Move: {
      if (
        !isFiniteNumber(obj["sequenceNumber"]) ||
        !isFiniteNumber(obj["dirX"]) ||
        !isFiniteNumber(obj["dirY"]) ||
        !isFiniteNumber(obj["deltaMs"]) ||
        obj["deltaMs"] < 0
      ) {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason:
            "MOVE requiert 'sequenceNumber', 'dirX', 'dirY' et 'deltaMs' (≥ 0) numériques",
        };
      }
      return {
        ok: true,
        message: {
          type: ClientMessageType.Move,
          sequenceNumber: obj["sequenceNumber"],
          dirX: obj["dirX"],
          dirY: obj["dirY"],
          deltaMs: obj["deltaMs"],
        },
      };
    }
    case ClientMessageType.GainXpDebug: {
      if (!isFiniteNumber(obj["amount"]) || obj["amount"] < 0) {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "GAIN_XP_DEBUG requiert un 'amount' numérique >= 0",
        };
      }
      return {
        ok: true,
        message: {
          type: ClientMessageType.GainXpDebug,
          amount: obj["amount"],
        },
      };
    }
    case ClientMessageType.AttackMob: {
      if (typeof obj["mobId"] !== "string" || obj["mobId"] === "") {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "ATTACK_MOB requiert un 'mobId' non vide",
        };
      }
      return {
        ok: true,
        message: { type: ClientMessageType.AttackMob, mobId: obj["mobId"] },
      };
    }
    case ClientMessageType.PickupLoot: {
      if (typeof obj["lootId"] !== "string" || obj["lootId"] === "") {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "PICKUP_LOOT requiert un 'lootId' non vide",
        };
      }
      return {
        ok: true,
        message: { type: ClientMessageType.PickupLoot, lootId: obj["lootId"] },
      };
    }
    case ClientMessageType.InfuseWeapon: {
      if (typeof obj["materialType"] !== "string" || obj["materialType"] === "") {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "INFUSE_WEAPON requiert un 'materialType' non vide",
        };
      }
      return {
        ok: true,
        message: {
          type: ClientMessageType.InfuseWeapon,
          materialType: obj["materialType"],
        },
      };
    }
    case ClientMessageType.CastSpell: {
      if (typeof obj["spellId"] !== "string" || obj["spellId"] === "") {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "CAST_SPELL requiert un 'spellId' non vide",
        };
      }
      const targetMobId = obj["targetMobId"];
      if (targetMobId !== undefined && typeof targetMobId !== "string") {
        return {
          ok: false,
          code: ErrorCode.InvalidPayload,
          reason: "CAST_SPELL: 'targetMobId' doit être une chaîne si fourni",
        };
      }
      return {
        ok: true,
        message: {
          type: ClientMessageType.CastSpell,
          spellId: obj["spellId"],
          ...(typeof targetMobId === "string" ? { targetMobId } : {}),
        },
      };
    }
    default:
      return {
        ok: false,
        code: ErrorCode.UnknownType,
        reason: `Type d'intention inconnu: ${String(obj["type"])}`,
      };
  }
};
