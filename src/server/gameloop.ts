import type { PlayerId } from "../models/ids.js";
import type { Player, Position } from "../models/player.js";
import { computeAggregatedStats } from "../models/stats.js";
import type { Weapon } from "../models/weapon.js";
import type { PersistenceLayer } from "../persistence/repository.js";

/**
 * Game Loop & Server Ticks (Brique 4).
 *
 * Moteur de simulation temps réel du serveur autoritaire. Une boucle à pas de
 * temps FIXE met à jour l'état du monde à intervalles réguliers :
 *   - régénération passive des PV des joueurs connectés ;
 *   - mise à jour des entités mobiles (monstres) — socle pour les briques
 *     suivantes (IA, combat).
 *
 * La boucle est démarrable/arrêtable proprement (`start`/`stop`) et expose
 * `tick()` publiquement pour des tests déterministes (sans dépendre du timer).
 */

/** Cadence de simulation : 20 ticks/seconde. */
export const TICK_RATE = 20;

/** Durée d'un tick en millisecondes (50 ms à 20 ticks/s). */
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;

/** Fraction des PV max régénérée par seconde par défaut (5 %/s). */
export const DEFAULT_REGEN_PER_SECOND = 0.05;

/**
 * Entité mobile générique présente dans le monde (socle pour les monstres).
 * Volontairement minimale pour ce jalon : PV + position dans une zone.
 */
export interface MobileEntity {
  id: string;
  name: string;
  pvActuels: number;
  pvMax: number;
  position: Position;
}

/** Un monstre est une entité mobile (alias sémantique pour l'instant). */
export type Monster = MobileEntity;

/**
 * Fournisseur des participants du monde : qui est connecté et doit être simulé.
 * Implémenté par le `GameHub` de la Brique 3.
 */
export interface WorldParticipants {
  connectedPlayerIds(): Iterable<PlayerId>;
}

export interface TickInfo {
  /** Numéro du tick (incrémenté à chaque pas). */
  tick: number;
  /** Pas de temps simulé en ms. */
  deltaMs: number;
  /** Nombre de joueurs traités sur ce tick. */
  playersProcessed: number;
}

export interface GameLoopOptions {
  persistence: PersistenceLayer;
  participants: WorldParticipants;
  /** Pas de temps entre deux ticks (défaut : 50 ms). */
  tickIntervalMs?: number;
  /** Régénération PV en fraction des PV max par seconde (défaut : 5 %/s). */
  regenPerSecond?: number;
  /** Hook appelé après chaque tick (ex : diffusion d'état). */
  onTick?: (info: TickInfo) => void;
}

export class GameLoop {
  private readonly persistence: PersistenceLayer;
  private readonly participants: WorldParticipants;
  private readonly tickIntervalMs: number;
  private readonly regenPerSecond: number;
  private readonly onTick: ((info: TickInfo) => void) | undefined;

  private timer: ReturnType<typeof setInterval> | undefined;
  private _tickCount = 0;
  /** Garde-fou anti-réentrance si un tick async dépasse l'intervalle. */
  private ticking = false;
  private readonly monsters = new Map<string, Monster>();

  constructor(options: GameLoopOptions) {
    this.persistence = options.persistence;
    this.participants = options.participants;
    this.tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
    this.regenPerSecond = options.regenPerSecond ?? DEFAULT_REGEN_PER_SECOND;
    this.onTick = options.onTick;
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  get tickCount(): number {
    return this._tickCount;
  }

  /** Démarre la boucle (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // tick() est async : on évite les chevauchements via `ticking`.
      void this.tick();
    }, this.tickIntervalMs);
    // Ne pas bloquer la fermeture du process Node uniquement pour la boucle.
    this.timer.unref?.();
  }

  /** Arrête la boucle proprement. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // -------------------------------------------------------------------------
  // Monstres / entités mobiles
  // -------------------------------------------------------------------------

  spawnMonster(monster: Monster): void {
    this.monsters.set(monster.id, monster);
  }

  removeMonster(id: string): boolean {
    return this.monsters.delete(id);
  }

  getMonsters(): Monster[] {
    return [...this.monsters.values()];
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /**
   * Avance la simulation d'un pas. Public pour des tests déterministes : on
   * peut appeler `tick()` manuellement sans timer.
   *
   * @param deltaMs durée simulée (défaut : l'intervalle configuré).
   */
  async tick(deltaMs: number = this.tickIntervalMs): Promise<TickInfo> {
    if (this.ticking) {
      // Un tick précédent est encore en cours : on saute celui-ci.
      return { tick: this._tickCount, deltaMs, playersProcessed: 0 };
    }
    this.ticking = true;
    try {
      const playersProcessed = await this.regenPlayers(deltaMs);
      this.updateMonsters(deltaMs);

      this._tickCount += 1;
      const info: TickInfo = {
        tick: this._tickCount,
        deltaMs,
        playersProcessed,
      };
      this.onTick?.(info);
      return info;
    } finally {
      this.ticking = false;
    }
  }

  /** Régénération passive des PV des joueurs connectés. */
  private async regenPlayers(deltaMs: number): Promise<number> {
    let processed = 0;
    for (const playerId of this.participants.connectedPlayerIds()) {
      const player = await this.persistence.players.get(playerId);
      if (!player) continue;
      processed += 1;

      const stats = await this.aggregate(player);
      if (player.pvActuels >= stats.pvMax) continue; // déjà au max

      const regen = stats.pvMax * this.regenPerSecond * (deltaMs / 1000);
      const next = Math.min(stats.pvMax, player.pvActuels + regen);
      if (next !== player.pvActuels) {
        player.pvActuels = next;
        await this.persistence.players.save(player);
      }
    }
    return processed;
  }

  /**
   * Mise à jour des entités mobiles. Pour ce jalon, les monstres sont inertes
   * (présence simulée) ; l'IA et le combat viendront dans une brique ultérieure.
   */
  private updateMonsters(_deltaMs: number): void {
    // Point d'extension : déplacement, agro, attaques...
  }

  /** Calcule les stats agrégées d'un joueur en résolvant ses armes équipées. */
  private async aggregate(player: Player) {
    const cache = new Map<string, Weapon>();
    for (const slot of [
      player.equipment.slotPrincipal,
      player.equipment.slotSecondaire,
    ]) {
      if (slot && !cache.has(slot)) {
        const weapon = await this.persistence.weapons.get(slot);
        if (weapon) cache.set(slot, weapon);
      }
    }
    return computeAggregatedStats(player, (id) => cache.get(id));
  }
}
