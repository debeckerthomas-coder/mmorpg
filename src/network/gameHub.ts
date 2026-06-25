import { createPlayer, createWeapon } from "../models/factory.js";
import type { PlayerId } from "../models/ids.js";
import type { Player } from "../models/player.js";
import { computeAggregatedStats, type AggregatedStats } from "../models/stats.js";
import { gainXp } from "../models/evolution.js";
import { WeaponType, type Weapon } from "../models/weapon.js";
import type { PersistenceLayer } from "../persistence/repository.js";
import { MobManager } from "../server/mobs.js";
import {
  computePlayerDamage,
  distance,
  weaponRange,
} from "../server/combat.js";
import {
  ClientMessageType,
  ErrorCode,
  ServerMessageType,
  parseClientMessage,
  type ClientMessage,
  type EquippedWeapons,
  type PublicMonster,
  type PublicPlayer,
  type PublicPortal,
  type ServerMessage,
} from "./protocol.js";

/**
 * Distance maximale autorisée pour une seule intention de déplacement.
 * Au-delà, le serveur considère le mouvement comme aberrant (téléportation /
 * triche) et le rejette en renvoyant l'état officiel au client.
 */
export const MAX_MOVE_DISTANCE = 50;

/**
 * Session d'un client connecté au hub.
 *
 * Volontairement découplée du WebSocket : `send` est une simple fonction, ce
 * qui rend le hub entièrement testable sans ouvrir de socket réelle.
 */
export interface Session {
  readonly id: string;
  /** Identifiant du joueur, défini après une intention CONNECT réussie. */
  playerId: PlayerId | null;
  send(message: ServerMessage): void;
}

/**
 * Cœur autoritaire de la couche réseau.
 *
 * Reçoit les intentions des clients (déjà détachées du transport), les valide,
 * applique les mutations sur les modèles via la persistance, puis renvoie /
 * diffuse les états. Aucune dépendance à `ws` ici.
 */
export class GameHub {
  private readonly sessions = new Map<string, Session>();
  private counter = 0;
  private readonly mobManager: MobManager;

  constructor(
    private readonly persistence: PersistenceLayer,
    mobManager: MobManager = new MobManager(),
  ) {
    this.mobManager = mobManager;
  }

  /** Gestionnaire du bestiaire (partagé avec la GameLoop). */
  get mobs(): MobManager {
    return this.mobManager;
  }

  /** Enregistre une nouvelle connexion et renvoie sa session. */
  register(send: Session["send"]): Session {
    const session: Session = {
      id: `conn-${++this.counter}`,
      playerId: null,
      send,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Retire une session (déconnexion) et informe les autres joueurs. */
  async unregister(session: Session): Promise<void> {
    this.sessions.delete(session.id);
    await this.broadcastWorld();
  }

  /** Nombre de sessions actuellement connectées (utile pour les tests). */
  get connectionCount(): number {
    return this.sessions.size;
  }

  /**
   * Identifiants des joueurs actuellement connectés (sessions ayant validé un
   * CONNECT). Consommé par la boucle de jeu (Brique 4) pour savoir quels
   * joueurs simuler à chaque tick.
   */
  connectedPlayerIds(): PlayerId[] {
    const ids: PlayerId[] = [];
    for (const session of this.sessions.values()) {
      if (session.playerId) ids.push(session.playerId);
    }
    return ids;
  }

  /**
   * Point d'entrée transport-agnostique : reçoit le texte brut d'un message,
   * le parse de façon sécurisée, puis dispatche. Ne lève jamais.
   */
  async handleRaw(session: Session, raw: string): Promise<void> {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      session.send({
        type: ServerMessageType.Error,
        code: parsed.code,
        message: parsed.reason,
      });
      return;
    }
    await this.handleMessage(session, parsed.message);
  }

  /** Dispatch d'une intention déjà validée. */
  async handleMessage(session: Session, message: ClientMessage): Promise<void> {
    switch (message.type) {
      case ClientMessageType.Connect:
        return this.onConnect(session, message.pseudo);
      case ClientMessageType.Move:
        return this.onMove(session, message.x, message.y);
      case ClientMessageType.GainXpDebug:
        return this.onGainXpDebug(session, message.amount);
      case ClientMessageType.AttackMob:
        return this.onAttackMob(session, message.mobId);
    }
  }

  // -------------------------------------------------------------------------
  // Handlers d'intentions
  // -------------------------------------------------------------------------

  private async onConnect(session: Session, pseudo: string): Promise<void> {
    const player = await this.loadOrCreatePlayer(pseudo);
    session.playerId = player.id;

    await this.sendPlayerState(session, player);
    await this.broadcastWorld();
  }

  private async onMove(session: Session, x: number, y: number): Promise<void> {
    const player = await this.requirePlayer(session);
    if (!player) return;

    const dx = x - player.position.x;
    const dy = y - player.position.y;
    const distance = Math.hypot(dx, dy);

    if (distance > MAX_MOVE_DISTANCE) {
      // Mouvement aberrant : on rejette et on renvoie l'état officiel
      // (le client doit « snap back » à la position autoritaire).
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.InvalidMove,
        message: `Déplacement trop grand (${distance.toFixed(
          1,
        )} > ${MAX_MOVE_DISTANCE})`,
      });
      await this.sendPlayerState(session, player);
      return;
    }

    player.position = { ...player.position, x, y };
    await this.persistence.players.save(player);

    await this.sendPlayerState(session, player);
    await this.broadcastWorld();
  }

  private async onGainXpDebug(
    session: Session,
    amount: number,
  ): Promise<void> {
    const player = await this.requirePlayer(session);
    if (!player) return;

    const weaponId = player.equipment.slotPrincipal;
    if (!weaponId) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.NoWeaponEquipped,
        message: "Aucune arme équipée dans le Slot_Principal",
      });
      return;
    }

    const weapon = await this.persistence.weapons.get(weaponId);
    if (!weapon) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.NoWeaponEquipped,
        message: "Arme équipée introuvable",
      });
      return;
    }

    gainXp(weapon, amount);
    await this.persistence.weapons.save(weapon);

    await this.sendPlayerState(session, player);
  }

  /**
   * Le joueur attaque un monstre. Le serveur valide la PORTÉE selon l'arme
   * principale (Épée/Bouclier = 1, Arc/Bâton = 5), calcule les dégâts depuis
   * les stats agrégées, et accorde l'XP à l'arme si le monstre meurt.
   */
  private async onAttackMob(session: Session, mobId: string): Promise<void> {
    const player = await this.requirePlayer(session);
    if (!player) return;

    const weaponId = player.equipment.slotPrincipal;
    const weapon = weaponId
      ? await this.persistence.weapons.get(weaponId)
      : undefined;
    if (!weapon) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.NoWeaponEquipped,
        message: "Aucune arme équipée pour attaquer",
      });
      return;
    }

    const mob = this.mobManager.getMonster(mobId);
    if (!mob) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.MobNotFound,
        message: "Monstre introuvable (déjà mort ?)",
      });
      return;
    }

    const range = weaponRange(weapon.type);
    if (distance(player.position, mob.position) > range) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.OutOfRange,
        message: `Cible hors de portée (max ${range})`,
      });
      return;
    }

    const { stats } = await this.aggregate(player);
    const damage = computePlayerDamage(weapon.type, stats);
    const result = this.mobManager.damageMob(mobId, damage);

    if (result?.killed) {
      // Le monstre meurt : l'arme principale gagne son XP (et peut monter).
      gainXp(weapon, mob.xpDonnee);
      await this.persistence.weapons.save(weapon);
    }

    // Renvoie l'état frais (recalcule les stats post-évolution éventuelle).
    await this.sendPlayerState(session, player);
    await this.broadcastWorld();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requirePlayer(session: Session): Promise<Player | undefined> {
    if (!session.playerId) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.NotConnected,
        message: "Envoyez d'abord une intention CONNECT",
      });
      return undefined;
    }
    const player = await this.persistence.players.get(session.playerId);
    if (!player) {
      session.send({
        type: ServerMessageType.Error,
        code: ErrorCode.NotConnected,
        message: "Joueur introuvable (session invalide)",
      });
      session.playerId = null;
    }
    return player;
  }

  /** Charge le joueur par pseudo, ou le crée (avec une arme de départ). */
  private async loadOrCreatePlayer(pseudo: string): Promise<Player> {
    const existing = (await this.persistence.players.getAll()).find(
      (p) => p.pseudo === pseudo,
    );
    if (existing) return existing;

    const starter = createWeapon("Épée d'entraînement", WeaponType.Epee, {
      rawStats: { force: 5, agilite: 1, pvBonus: 0 },
    });
    const player = createPlayer(pseudo, {
      equipment: { slotPrincipal: starter.id, slotSecondaire: null },
    });

    await this.persistence.weapons.save(starter);
    await this.persistence.players.save(player);
    return player;
  }

  /**
   * Résout les armes équipées et calcule les stats agrégées d'un joueur.
   * Réutilisé par PLAYER_STATE et par la validation des attaques.
   */
  private async aggregate(player: Player): Promise<{
    stats: AggregatedStats;
    weapons: EquippedWeapons;
  }> {
    const load = async (id: Player["equipment"]["slotPrincipal"]) =>
      id ? ((await this.persistence.weapons.get(id)) ?? null) : null;
    const weapons: EquippedWeapons = {
      slotPrincipal: await load(player.equipment.slotPrincipal),
      slotSecondaire: await load(player.equipment.slotSecondaire),
    };

    const cache = new Map<string, Weapon>();
    if (weapons.slotPrincipal) cache.set(weapons.slotPrincipal.id, weapons.slotPrincipal);
    if (weapons.slotSecondaire) cache.set(weapons.slotSecondaire.id, weapons.slotSecondaire);

    const stats = computeAggregatedStats(player, (id) => cache.get(id));
    return { stats, weapons };
  }

  private async sendPlayerState(
    session: Session,
    player: Player,
  ): Promise<void> {
    const { stats, weapons } = await this.aggregate(player);
    session.send({
      type: ServerMessageType.PlayerState,
      player,
      stats,
      weapons,
    });
  }

  /**
   * Diffuse à tous les clients l'état du monde : joueurs présents, portails
   * ouverts et monstres actifs (Brique 6). Public pour que la GameLoop puisse
   * la déclencher après chaque tick d'IA.
   */
  async broadcastWorld(): Promise<void> {
    const players: PublicPlayer[] = [];
    for (const session of this.sessions.values()) {
      if (!session.playerId) continue;
      const player = await this.persistence.players.get(session.playerId);
      if (player) {
        players.push({
          id: player.id,
          pseudo: player.pseudo,
          position: player.position,
        });
      }
    }

    const portals: PublicPortal[] = this.mobManager.getPortals().map((p) => ({
      id: p.id,
      rank: p.rank,
      position: p.position,
      open: p.open,
    }));

    const monsters: PublicMonster[] = this.mobManager.getMonsters().map((m) => ({
      id: m.id,
      rank: m.rank,
      pvActuels: m.pvActuels,
      pvMax: m.pvMax,
      position: m.position,
    }));

    const message: ServerMessage = {
      type: ServerMessageType.WorldUpdate,
      players,
      portals,
      monsters,
    };
    for (const session of this.sessions.values()) {
      session.send(message);
    }
  }
}
