import {
  ClientMessageType,
  ServerMessageType,
  type AggregatedStatsView,
  type ClientMessage,
  type PlayerStateMessage,
  type PlayerView,
  type PortalRank,
  type PublicLoot,
  type PublicMonster,
  type PublicPortal,
  type ServerMessage,
  type Spell,
  type WeaponView,
  type WorldUpdateMessage,
  MaterialType,
} from "./protocol";
import { applyMove, type MoveInput, type Point } from "./movement";

// --- Constantes monde / rendu (miroir du serveur) ---
const WS_URL = `ws://${location.hostname || "localhost"}:8080`;
const WORLD_SIZE = 500; // unités logiques de la zone
/** Seuil de déviation (cases) au-delà duquel on « snap » sur le serveur. */
const RECONCILE_SNAP_THRESHOLD = 0.01;

// --- Helpers DOM ---
const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Élément introuvable: #${id}`);
  return node as T;
};

const loginScreen = el("login");
const gameScreen = el("game");
const pseudoInput = el<HTMLInputElement>("pseudo");
const joinBtn = el<HTMLButtonElement>("join");
const loginStatus = el("login-status");
const gainXpBtn = el<HTMLButtonElement>("gain-xp");
const infuseClawBtn = el<HTMLButtonElement>("infuse-claw");
const infuseStoneBtn = el<HTMLButtonElement>("infuse-stone");
const spellsEl = el("spells");
const logEl = el("log");
const canvas = el<HTMLCanvasElement>("map");
const ctx = canvas.getContext("2d")!;
const scale = canvas.width / WORLD_SIZE;

// --- État client (purement présentation : l'autorité reste le serveur) ---
let socket: WebSocket | null = null;
let me: PlayerView | null = null;
let stats: AggregatedStatsView | null = null;
let weapons: PlayerStateMessage["weapons"] | null = null;
let others: WorldUpdateMessage["players"] = [];
let portals: PublicPortal[] = [];
let monsters: PublicMonster[] = [];
let loots: PublicLoot[] = [];

/** Couleur de rendu d'un loot selon son matériau. */
const MATERIAL_COLOR: Record<string, string> = {
  [MaterialType.GriffeChauveSouris]: "#c9a227", // doré/brun (griffe)
  [MaterialType.CaillouBrillant]: "#4fd2ff", // cyan brillant (caillou)
};
const MATERIAL_LABEL: Record<string, string> = {
  [MaterialType.GriffeChauveSouris]: "Griffes",
  [MaterialType.CaillouBrillant]: "Cailloux",
};

// --- Prédiction & réconciliation ---
/** Position prédite localement (rendue à 60 FPS, avant confirmation serveur). */
let predicted: Point | null = null;
/** Compteur de séquence des inputs envoyés. */
let inputSeq = 0;
/** Inputs envoyés mais pas encore confirmés par le serveur. */
let pendingInputs: MoveInput[] = [];
/** Touches actuellement enfoncées. */
const heldKeys = new Set<string>();
let lastFrameTime = 0;
let loopStarted = false;

// --- Sorts (Brique 10) ---
/** Sorts utilisables (mappés sur les touches 1/2/3). */
let usableSpells: Spell[] = [];
/** Fin de l'effet visuel de sort (timestamp ms). */
let castEffectUntil = 0;

/** Couleur de rendu d'un portail selon son rang. */
const RANK_COLOR: Record<PortalRank, string> = {
  C: "#2ecc71", // vert
  B: "#3498db", // bleu
  A: "#9b59ff", // violet
  S: "#ff5470", // rouge
};

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

const send = (message: ClientMessage): void => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const connect = (pseudo: string): void => {
  loginStatus.textContent = "Connexion…";
  loginStatus.classList.remove("error");

  socket = new WebSocket(WS_URL);

  socket.addEventListener("open", () => {
    send({ type: ClientMessageType.Connect, pseudo });
  });

  socket.addEventListener("message", (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data as string) as ServerMessage;
    } catch {
      return;
    }
    handleServerMessage(msg);
  });

  socket.addEventListener("error", () => {
    loginStatus.textContent = `Impossible de joindre le serveur (${WS_URL}).`;
    loginStatus.classList.add("error");
  });

  socket.addEventListener("close", () => {
    if (gameScreen.hidden) {
      loginStatus.textContent = "Connexion fermée.";
      loginStatus.classList.add("error");
    } else {
      flashLog("Connexion au serveur perdue.");
    }
  });
};

const handleServerMessage = (msg: ServerMessage): void => {
  switch (msg.type) {
    case ServerMessageType.PlayerState:
      me = msg.player;
      stats = msg.stats;
      weapons = msg.weapons;
      reconcile(msg.player.position, msg.lastProcessedSequence);
      enterGame();
      startLoop();
      renderHud();
      break;
    case ServerMessageType.WorldUpdate:
      others = msg.players;
      portals = msg.portals;
      monsters = msg.monsters;
      loots = msg.loots;
      break;
    case ServerMessageType.Error:
      flashLog(`⚠️ ${msg.code} — ${msg.message}`);
      break;
  }
};

/**
 * Réconciliation : on repart de la position **autoritaire** du serveur, on
 * écarte les inputs déjà traités, puis on **rejoue** les inputs encore en
 * attente pour retrouver une prédiction cohérente. Si l'écart avec la
 * prédiction courante est négligeable, on garde le rendu fluide.
 */
const reconcile = (serverPos: Point, lastProcessed: number): void => {
  pendingInputs = pendingInputs.filter(
    (i) => i.sequenceNumber > lastProcessed,
  );

  let authoritative: Point = { x: serverPos.x, y: serverPos.y };
  for (const input of pendingInputs) {
    authoritative = applyMove(authoritative, input);
  }

  if (!predicted) {
    predicted = authoritative;
    return;
  }
  const drift = Math.hypot(predicted.x - authoritative.x, predicted.y - authoritative.y);
  if (drift > RECONCILE_SNAP_THRESHOLD) {
    // Le serveur a corrigé notre trajectoire (rejet d'un mouvement triché,
    // collision, etc.) → on applique le correctif.
    predicted = authoritative;
  }
};

const enterGame = (): void => {
  if (!gameScreen.hidden) return;
  loginScreen.hidden = true;
  gameScreen.hidden = false;
};

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

const renderHud = (): void => {
  if (!me || !stats) return;

  el("hud-pseudo").textContent = me.pseudo;

  const pk = el("hud-pk");
  pk.textContent = me.pk ? "PK" : "Pacifiste";
  pk.className = `badge ${me.pk ? "pk" : "pacifist"}`;

  const pvMax = stats.pvMax;
  const pv = Math.round(me.pvActuels * 10) / 10;
  el("hp-text").textContent = `${pv} / ${pvMax}`;
  const pct = pvMax > 0 ? Math.max(0, Math.min(100, (me.pvActuels / pvMax) * 100)) : 0;
  el("hp-fill").style.width = `${pct}%`;

  // Barre de PM
  const pmMax = stats.pmMax;
  const pm = Math.round(me.pmActuels * 10) / 10;
  el("pm-text").textContent = `${pm} / ${pmMax}`;
  const pmPct = pmMax > 0 ? Math.max(0, Math.min(100, (me.pmActuels / pmMax) * 100)) : 0;
  el("pm-fill").style.width = `${pmPct}%`;

  // Sorts utilisables (mappés sur 1/2/3)
  usableSpells = stats.usableSpells;
  renderSpells();

  const activeAffixIds = new Set(stats.activeAffixes.map((a) => a.id));
  const activeSpellIds = new Set(stats.usableSpells.map((s) => s.id));

  renderSlot(
    "slot-principal",
    weapons?.slotPrincipal ?? null,
    activeAffixIds,
    activeSpellIds,
  );
  renderSlot(
    "slot-secondaire",
    weapons?.slotSecondaire ?? null,
    activeAffixIds,
    activeSpellIds,
  );

  const s = stats.rawStats;
  el("agg-stats").innerHTML = `
    Force <b>${s["force"] ?? 0}</b> · Agilité <b>${s["agilite"] ?? 0}</b><br/>
    Bonus PV <b>${s["pvBonus"] ?? 0}</b> · PV max <b>${pvMax}</b>`;

  // Inventaire de matériaux
  const claws = me.materials[MaterialType.GriffeChauveSouris] ?? 0;
  const stones = me.materials[MaterialType.CaillouBrillant] ?? 0;
  el("materials").innerHTML = `
    🦇 ${MATERIAL_LABEL[MaterialType.GriffeChauveSouris]} <b>${claws}</b><br/>
    💎 ${MATERIAL_LABEL[MaterialType.CaillouBrillant]} <b>${stones}</b>`;
  infuseClawBtn.disabled = claws < 50;
  infuseStoneBtn.disabled = stones < 20;
};

const renderSlot = (
  slotId: string,
  weapon: WeaponView | null,
  activeAffixIds: Set<string>,
  activeSpellIds: Set<string>,
): void => {
  const body = el(slotId).querySelector(".slot-body")!;
  if (!weapon) {
    body.textContent = "Vide";
    return;
  }

  const prog = weapon.progression;
  const xpPct = prog.nextLevelXp > 0
    ? Math.min(100, (prog.currentXp / prog.nextLevelXp) * 100)
    : 0;

  const affixTags = weapon.affixes
    .map((a) => {
      const active = activeAffixIds.has(a.id);
      return `<span class="tag ${active ? "" : "inactive"}" title="${a.rarity} · puissance ${a.power}">${a.label}</span>`;
    })
    .join("");

  const spellTags = weapon.generatedSpells
    .map((sp) => {
      const active = activeSpellIds.has(sp.id);
      return `<span class="tag spell ${active ? "" : "inactive"}">${sp.name}</span>`;
    })
    .join("");

  body.innerHTML = `
    <div><span class="weapon-name">${weapon.name}</span>
      <span class="lvl">Nv.${prog.level}</span> · ${weapon.type}</div>
    <div class="xp-bar"><div class="xp-fill" style="width:${xpPct}%"></div></div>
    <div class="xp-text" style="font-size:.7rem;color:var(--muted)">
      XP ${prog.currentXp} / ${prog.nextLevelXp}</div>
    <div class="tags">${affixTags || ""}${spellTags || ""}</div>`;
};

const flashLog = (text: string): void => {
  logEl.textContent = text;
  window.setTimeout(() => {
    if (logEl.textContent === text) logEl.textContent = "";
  }, 2500);
};

// --- Sorts : boutons + cooldowns + lancement ---

const renderSpells = (): void => {
  if (usableSpells.length === 0) {
    spellsEl.innerHTML = "Aucun sort actif";
    return;
  }
  spellsEl.innerHTML = usableSpells
    .map(
      (sp, i) =>
        `<button class="spell-btn" data-spell-id="${sp.id}" data-cost="${sp.cost}">
           <span class="key">${i + 1}</span>${sp.name}<span class="cost">${sp.cost} PM</span>
           <span class="cd-overlay" hidden></span>
         </button>`,
    )
    .join("");
};

/** Met à jour les overlays de cooldown et l'état (dés)activé des boutons. */
const updateSpellCooldowns = (): void => {
  if (!me) return;
  const now = Date.now();
  for (const btn of spellsEl.querySelectorAll<HTMLButtonElement>(".spell-btn")) {
    const id = btn.dataset["spellId"] ?? "";
    const cost = Number(btn.dataset["cost"] ?? 0);
    const overlay = btn.querySelector<HTMLElement>(".cd-overlay");
    const remaining = (me.cooldownEndTimestamps[id] ?? 0) - now;
    if (remaining > 0) {
      if (overlay) {
        overlay.hidden = false;
        overlay.textContent = `${(remaining / 1000).toFixed(1)}s`;
      }
      btn.disabled = true;
    } else {
      if (overlay) overlay.hidden = true;
      btn.disabled = me.pmActuels < cost;
    }
  }
};

const cast = (spellId: string): void => {
  send({ type: ClientMessageType.CastSpell, spellId });
  castEffectUntil = Date.now() + 300; // effet visuel optimiste
};

spellsEl.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".spell-btn");
  if (btn && !btn.disabled) cast(btn.dataset["spellId"] ?? "");
});

window.addEventListener("keydown", (e) => {
  if (gameScreen.hidden) return;
  const idx = ["1", "2", "3"].indexOf(e.key);
  if (idx >= 0) {
    const sp = usableSpells[idx];
    if (sp) cast(sp.id);
  }
});

// ---------------------------------------------------------------------------
// Rendu de la zone (canvas)
// ---------------------------------------------------------------------------

const worldToCanvas = (v: number): number => v * scale;

const renderWorld = (): void => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grille du biome
  ctx.strokeStyle = "#15211c";
  ctx.lineWidth = 1;
  const step = 50 * scale;
  for (let p = 0; p <= canvas.width; p += step) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, canvas.height);
    ctx.moveTo(0, p);
    ctx.lineTo(canvas.width, p);
    ctx.stroke();
  }

  // Portails (cercles colorés selon le rang)
  for (const portal of portals) {
    const cx = worldToCanvas(portal.position.x);
    const cy = worldToCanvas(portal.position.y);
    const color = RANK_COLOR[portal.rank];
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = color + "33";
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Rang ${portal.rank}`, cx, cy - 16);
  }

  // Monstres (carrés rouges avec barre de PV)
  for (const mob of monsters) {
    const cx = worldToCanvas(mob.position.x);
    const cy = worldToCanvas(mob.position.y);
    const size = 12;
    ctx.fillStyle = "#ff5470";
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    // Barre de PV
    const w = 16;
    const pct = mob.pvMax > 0 ? Math.max(0, mob.pvActuels / mob.pvMax) : 0;
    ctx.fillStyle = "#3a1620";
    ctx.fillRect(cx - w / 2, cy - size, w, 3);
    ctx.fillStyle = "#ff8aa0";
    ctx.fillRect(cx - w / 2, cy - size, w * pct, 3);
  }

  // Loots au sol (petits losanges colorés selon le matériau)
  for (const loot of loots) {
    const cx = worldToCanvas(loot.position.x);
    const cy = worldToCanvas(loot.position.y);
    const color = MATERIAL_COLOR[loot.materialType] ?? "#ffffff";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
    ctx.fillStyle = color;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`×${loot.amount}`, cx, cy - 9);
  }

  // Autres joueurs
  for (const p of others) {
    if (me && p.id === me.id) continue;
    drawEntity(p.position.x, p.position.y, "#5b6478", p.pseudo);
  }

  // Soi-même : on rend la position PRÉDITE (fluide), pas la dernière reçue.
  if (me) {
    const self = predicted ?? me.position;
    drawEntity(self.x, self.y, "#7c5cff", me.pseudo, true);

    // Effet de sort : cercle bleu/blanc éphémère (rayon ≈ AoE de 2 cases).
    const remaining = castEffectUntil - Date.now();
    if (remaining > 0) {
      const t = remaining / 300; // 1 → 0
      ctx.beginPath();
      ctx.arc(
        worldToCanvas(self.x),
        worldToCanvas(self.y),
        worldToCanvas(2) * (1.2 - t * 0.5),
        0,
        Math.PI * 2,
      );
      ctx.strokeStyle = `rgba(150, 210, 255, ${t})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
};

const drawEntity = (
  x: number,
  y: number,
  color: string,
  label: string,
  isSelf = false,
): void => {
  const cx = worldToCanvas(x);
  const cy = worldToCanvas(y);
  const size = 16;
  ctx.fillStyle = color;
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  if (isSelf) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
  }
  ctx.fillStyle = "#e8e8f0";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, cx, cy - size);
};

// ---------------------------------------------------------------------------
// Combat : clic sur un monstre proche
// ---------------------------------------------------------------------------

/** Rayon (en pixels) pour considérer qu'un clic vise un monstre. */
const MOB_CLICK_RADIUS = 14;

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;

  // 1) Priorité au combat : monstre proche → attaque.
  let nearestMob: PublicMonster | null = null;
  let mobDist = MOB_CLICK_RADIUS;
  for (const mob of monsters) {
    const d = Math.hypot(
      worldToCanvas(mob.position.x) - px,
      worldToCanvas(mob.position.y) - py,
    );
    if (d <= mobDist) {
      mobDist = d;
      nearestMob = mob;
    }
  }
  if (nearestMob) {
    send({ type: ClientMessageType.AttackMob, mobId: nearestMob.id });
    return;
  }

  // 2) Sinon : loot proche → ramassage (portée validée serveur).
  let nearestLoot: PublicLoot | null = null;
  let lootDist = MOB_CLICK_RADIUS;
  for (const loot of loots) {
    const d = Math.hypot(
      worldToCanvas(loot.position.x) - px,
      worldToCanvas(loot.position.y) - py,
    );
    if (d <= lootDist) {
      lootDist = d;
      nearestLoot = loot;
    }
  }
  if (nearestLoot) {
    send({ type: ClientMessageType.PickupLoot, lootId: nearestLoot.id });
  }
});

// ---------------------------------------------------------------------------
// Déplacement prédictif (ZQSD / WASD / flèches) — boucle 60 FPS
// ---------------------------------------------------------------------------

const MOVE_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "w", "a", "s", "d", "z", "q",
]);

window.addEventListener("keydown", (e) => {
  if (MOVE_KEYS.has(e.key)) {
    heldKeys.add(e.key);
    if (!gameScreen.hidden) e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => heldKeys.delete(e.key));
// Sécurité : si la fenêtre perd le focus, on relâche tout.
window.addEventListener("blur", () => heldKeys.clear());

/** Vecteur de direction (normalisé plus tard par le serveur) issu des touches. */
const directionFromKeys = (): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  if (heldKeys.has("ArrowUp") || heldKeys.has("w") || heldKeys.has("z")) y -= 1;
  if (heldKeys.has("ArrowDown") || heldKeys.has("s")) y += 1;
  if (heldKeys.has("ArrowLeft") || heldKeys.has("a") || heldKeys.has("q")) x -= 1;
  if (heldKeys.has("ArrowRight") || heldKeys.has("d")) x += 1;
  return { x, y };
};

/** Démarre la boucle de rendu/prédiction (idempotent). */
const startLoop = (): void => {
  if (loopStarted) return;
  loopStarted = true;
  lastFrameTime = performance.now();
  requestAnimationFrame(frame);
};

const frame = (now: number): void => {
  const deltaMs = now - lastFrameTime;
  lastFrameTime = now;

  if (me) {
    const dir = directionFromKeys();
    const base: Point = predicted ?? me.position;

    if (dir.x !== 0 || dir.y !== 0) {
      const input: MoveInput = {
        sequenceNumber: ++inputSeq,
        dirX: dir.x,
        dirY: dir.y,
        deltaMs,
      };
      // 1) Prédiction locale immédiate (mouvement fluide, sans attendre le serveur).
      predicted = applyMove(base, input);
      // 2) On conserve l'input en attente de confirmation (pour le rejeu).
      pendingInputs.push(input);
      // 3) On envoie l'intention au serveur autoritaire.
      send({ type: ClientMessageType.Move, ...input });
    }
    renderWorld();
    updateSpellCooldowns();
  }

  requestAnimationFrame(frame);
};

// ---------------------------------------------------------------------------
// Interactions UI
// ---------------------------------------------------------------------------

joinBtn.addEventListener("click", () => {
  const pseudo = pseudoInput.value.trim();
  if (!pseudo) {
    loginStatus.textContent = "Entrez un pseudo.";
    loginStatus.classList.add("error");
    return;
  }
  connect(pseudo);
});

pseudoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});

gainXpBtn.addEventListener("click", () => {
  send({ type: ClientMessageType.GainXpDebug, amount: 50 });
});

infuseClawBtn.addEventListener("click", () => {
  send({
    type: ClientMessageType.InfuseWeapon,
    materialType: MaterialType.GriffeChauveSouris,
  });
});

infuseStoneBtn.addEventListener("click", () => {
  send({
    type: ClientMessageType.InfuseWeapon,
    materialType: MaterialType.CaillouBrillant,
  });
});
