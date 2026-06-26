import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_INPUT_DELTA_MS,
  PLAYER_SPEED,
  applyMove,
  clampDelta,
  isMoveWithinLimit,
  maxDistanceFor,
} from "./movement.js";

const near = (a: number, b: number, eps = 1e-6): boolean =>
  Math.abs(a - b) <= eps;

test("maxDistanceFor = vitesse × Δt (Δt borné)", () => {
  assert.ok(near(maxDistanceFor(100), PLAYER_SPEED * 0.1)); // 12
  assert.ok(near(maxDistanceFor(1000), PLAYER_SPEED * (MAX_INPUT_DELTA_MS / 1000)));
  assert.equal(clampDelta(100000), MAX_INPUT_DELTA_MS);
});

test("applyMove : un input conforme déplace de vitesse × Δt", () => {
  const next = applyMove({ x: 100, y: 100 }, {
    sequenceNumber: 1,
    dirX: 1,
    dirY: 0,
    deltaMs: 100,
  });
  assert.ok(near(next.x, 100 + 12), `x attendu ~112, reçu ${next.x}`);
  assert.ok(near(next.y, 100));
});

test("applyMove : la direction est normalisée (diagonale = même vitesse)", () => {
  const from = { x: 100, y: 100 };
  const next = applyMove(from, { sequenceNumber: 1, dirX: 1, dirY: 1, deltaMs: 100 });
  const moved = Math.hypot(next.x - from.x, next.y - from.y);
  assert.ok(near(moved, 12), `déplacement attendu ~12, reçu ${moved}`);
});

test("applyMove REJETTE la triche par vecteur géant (vitesse bornée)", () => {
  const from = { x: 100, y: 100 };
  const next = applyMove(from, {
    sequenceNumber: 1,
    dirX: 99999,
    dirY: 0,
    deltaMs: 100,
  });
  const moved = Math.hypot(next.x - from.x, next.y - from.y);
  // Malgré un vecteur énorme, le déplacement reste borné à vitesse × Δt.
  assert.ok(near(moved, 12), `déplacement borné attendu ~12, reçu ${moved}`);
});

test("applyMove REJETTE la triche par Δt géant (téléportation)", () => {
  const from = { x: 100, y: 100 };
  const next = applyMove(from, {
    sequenceNumber: 1,
    dirX: 1,
    dirY: 0,
    deltaMs: 100000, // énorme → borné à MAX_INPUT_DELTA_MS
  });
  const moved = Math.hypot(next.x - from.x, next.y - from.y);
  const expected = PLAYER_SPEED * (MAX_INPUT_DELTA_MS / 1000); // 30
  assert.ok(near(moved, expected), `déplacement borné attendu ~${expected}, reçu ${moved}`);
});

test("applyMove : direction nulle ne bouge pas", () => {
  const from = { x: 50, y: 50 };
  const next = applyMove(from, { sequenceNumber: 1, dirX: 0, dirY: 0, deltaMs: 16 });
  assert.deepEqual(next, from);
});

test("applyMove borne la position dans le monde", () => {
  const next = applyMove({ x: 0, y: 0 }, {
    sequenceNumber: 1,
    dirX: -1,
    dirY: 0,
    deltaMs: 100,
  });
  assert.equal(next.x, 0); // ne sort pas par la gauche
});

test("isMoveWithinLimit : accepte un mouvement conforme, rejette téléport/excès", () => {
  const from = { x: 0, y: 0 };
  // Conforme : 12 cases en 100 ms (= max) → accepté.
  assert.equal(isMoveWithinLimit(from, { x: 12, y: 0 }, 100), true);
  // Téléportation : 500 cases en 100 ms → rejeté.
  assert.equal(isMoveWithinLimit(from, { x: 500, y: 0 }, 100), false);
  // Vitesse excessive : 50 cases en 100 ms → rejeté.
  assert.equal(isMoveWithinLimit(from, { x: 50, y: 0 }, 100), false);
});
