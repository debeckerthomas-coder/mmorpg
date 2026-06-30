import type { PlayerId } from "../models/ids.js";
import type { Player } from "../models/player.js";
import { computeAggregatedStats } from "../models/stats.js";
import type { Weapon } from "../models/weapon.js";
import type { PersistenceLayer } from "../persistence/repository.js";
import type { PlayerPosition } from "./combat.js";
import { MobManager } from "./mobs.js";

/**
 * Game Loop & Server Ticks (Briques 4 & 6).
 *
 * Moteur de simulation temps réel du serveur autoritaire. Une boucle à pas de
 * temps FIXE met à jour l'état du monde à intervalles réguliers :
 *   - IA des monstres (déplacement vers les joueurs, attaques) via MobManager ;
 *   - application des dégâts subis par les joueurs ;
 *   - régénération passive des PV des joueurs connectés.
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

/** Fraction du PM max régénérée par seconde par défaut (2 %/s, Brique 10). */
export const DEFAULT_PM_REGEN_PER_SECOND = 0.02;

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
  /** Gestionnaire du bestiaire (partagé avec le GameHub). */
  mobManager?: MobManager;
  /** Pas de temps entre deux ticks (défaut : 50 ms). */
  tickIntervalMs?: number;
  /** Régénération PV en fraction des PV max par seconde (défaut : 5 %/s). */
  regenPerSecond?: number;
  /** Régénération PM en fraction du PM max par seconde (défaut : 2 %/s). */
  pmRegenPerSecond?: number;
  /** Hook appelé après chaque tick (ex : diffusion d'état). */
  onTick?: (info: TickInfo) => void;
}

export class GameLoop {
  private readonly persistence: PersistenceLayer;
  private readonly participants: WorldParticipants;
  private readonly mobManager: MobManager;
  private readonly tickIntervalMs: number;
  private readonly regenPerSecond: number;
  private readonly pmRegenPerSecond: number;
  private readonly onTick: ((info: TickInfo) => void) | undefined;

  private timer: ReturnType<typeof setInterval> | undefined;
  private _tickCount = 0;
  /** Garde-fou anti-réentrance si un tick async dépasse l'intervalle. */
  private ticking = false;

  constructor(options: GameLoopOptions) {
    this.persistence = options.persistence;
    this.participants = options.participants;
    this.mobManager = options.mobManager ?? new MobManager();
    this.tickIntervalMs = options.tickIntervalMs ?? TICK_INTERVAL_MS;
    this.regenPerSecond = options.regenPerSecond ?? DEFAULT_REGEN_PER_SECOND;
    this.pmRegenPerSecond =
      options.pmRegenPerSecond ?? DEFAULT_PM_REGEN_PER_SECOND;
    this.onTick = options.onTick;
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }

  get tickCount(): number {
    return this._tickCount;
  }

  /** Gestionnaire du bestiaire (portails + monstres). */
  get mobs(): MobManager {
    return this.mobManager;
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
      const playersProcessed = await this.simulatePlayers(deltaMs);

      this._tickCount += 1;
      const info: TickInfo = { tick: this._tickCount, deltaMs, playersProcessed };
      this.onTick?.(info);
      return info;
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Traite les joueurs connectés sur un tick : IA/attaques des monstres
   * (dégâts subis) puis régénération passive. Persiste les joueurs modifiés.
   */
  private async simulatePlayers(deltaMs: number): Promise<number> {
    // 1) Charger les entités des joueurs connectés.
    const entities = new Map<PlayerId, Player>();
    const positions: PlayerPosition[] = [];
    for (const playerId of this.participants.connectedPlayerIds()) {
      const player = await this.persistence.players.get(playerId);
      if (!player) continue;
      entities.set(playerId, player);
      positions.push({ id: playerId, position: player.position });
    }

    const dirty = new Set<PlayerId>();

    // 2) IA des monstres : déplacement + attaques → dégâts subis.
    for (const event of this.mobManager.tick(deltaMs, positions)) {
      const player = entities.get(event.playerId);
      if (!player) continue;
      player.pvActuels = Math.max(0, player.pvActuels - event.amount);
      dirty.add(event.playerId);
    }

    // 3) Régénération passive des PV et des PM (joueurs vivants).
    for (const [playerId, player] of entities) {
      if (player.pvActuels <= 0) continue;
      const stats = await this.aggregate(player);

      // PV
      if (player.pvActuels < stats.pvMax) {
        const regen = stats.pvMax * this.regenPerSecond * (deltaMs / 1000);
        const next = Math.min(stats.pvMax, player.pvActuels + regen);
        if (next !== player.pvActuels) {
          player.pvActuels = next;
          dirty.add(playerId);
        }
      }

      // PM (Brique 10)
      if (player.pmActuels < stats.pmMax) {
        const regen = stats.pmMax * this.pmRegenPerSecond * (deltaMs / 1000);
        const next = Math.min(stats.pmMax, player.pmActuels + regen);
        if (next !== player.pmActuels) {
          player.pmActuels = next;
          dirty.add(playerId);
        }
      }
    }

    // 4) Persister les modifications.
    for (const playerId of dirty) {
      const player = entities.get(playerId);
      if (player) await this.persistence.players.save(player);
    }

    return entities.size;
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
