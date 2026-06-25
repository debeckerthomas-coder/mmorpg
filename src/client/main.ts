import {
  ClientMessageType,
  ServerMessageType,
  type AggregatedStatsView,
  type ClientMessage,
  type PlayerStateMessage,
  type PlayerView,
  type PortalRank,
  type PublicMonster,
  type PublicPortal,
  type ServerMessage,
  type WeaponView,
  type WorldUpdateMessage,
} from "./protocol";

// --- Constantes monde / rendu (miroir du serveur) ---
const WS_URL = `ws://${location.hostname || "localhost"}:8080`;
const WORLD_SIZE = 500; // unités logiques de la zone
const MAX_MOVE_DISTANCE = 50; // doit refléter le serveur (anti-téléportation)
const KEY_STEP = 16; // pas de déplacement au clavier

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
      enterGame();
      renderHud();
      renderWorld();
      break;
    case ServerMessageType.WorldUpdate:
      others = msg.players;
      portals = msg.portals;
      monsters = msg.monsters;
      renderWorld();
      break;
    case ServerMessageType.Error:
      flashLog(`⚠️ ${msg.code} — ${msg.message}`);
      break;
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

  // Autres joueurs
  for (const p of others) {
    if (me && p.id === me.id) continue;
    drawEntity(p.position.x, p.position.y, "#5b6478", p.pseudo);
  }

  // Soi-même
  if (me) {
    drawEntity(me.position.x, me.position.y, "#7c5cff", me.pseudo, true);
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
// Déplacements (intentions MOVE)
// ---------------------------------------------------------------------------

const clampToWorld = (v: number): number =>
  Math.max(0, Math.min(WORLD_SIZE, v));

/** Limite un déplacement à MAX_MOVE_DISTANCE depuis la position courante. */
const moveTowards = (targetX: number, targetY: number): void => {
  if (!me) return;
  const dx = targetX - me.position.x;
  const dy = targetY - me.position.y;
  const dist = Math.hypot(dx, dy);

  let x = targetX;
  let y = targetY;
  if (dist > MAX_MOVE_DISTANCE) {
    const k = (MAX_MOVE_DISTANCE - 1) / dist; // marge pour rester accepté
    x = me.position.x + dx * k;
    y = me.position.y + dy * k;
  }
  send({
    type: ClientMessageType.Move,
    x: clampToWorld(x),
    y: clampToWorld(y),
  });
};

/** Rayon (en pixels) pour considérer qu'un clic vise un monstre. */
const MOB_CLICK_RADIUS = 14;

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((e.clientY - rect.top) / rect.height) * canvas.height;

  // Clic sur un monstre proche → intention d'attaque (portée validée serveur).
  let nearest: PublicMonster | null = null;
  let nearestDist = MOB_CLICK_RADIUS;
  for (const mob of monsters) {
    const d = Math.hypot(worldToCanvas(mob.position.x) - px, worldToCanvas(mob.position.y) - py);
    if (d <= nearestDist) {
      nearestDist = d;
      nearest = mob;
    }
  }
  if (nearest) {
    send({ type: ClientMessageType.AttackMob, mobId: nearest.id });
    return;
  }

  // Sinon : déplacement vers le point cliqué.
  moveTowards(px / scale, py / scale);
});

window.addEventListener("keydown", (e) => {
  if (!me || gameScreen.hidden) return;
  let dx = 0;
  let dy = 0;
  switch (e.key) {
    case "ArrowUp":
    case "w":
    case "z":
      dy = -KEY_STEP;
      break;
    case "ArrowDown":
    case "s":
      dy = KEY_STEP;
      break;
    case "ArrowLeft":
    case "a":
    case "q":
      dx = -KEY_STEP;
      break;
    case "ArrowRight":
    case "d":
      dx = KEY_STEP;
      break;
    default:
      return;
  }
  e.preventDefault();
  moveTowards(me.position.x + dx, me.position.y + dy);
});

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
