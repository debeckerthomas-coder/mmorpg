import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ClientMessageType,
  ErrorCode,
  parseClientMessage,
} from "./protocol.js";

test("parse un CONNECT valide", () => {
  const r = parseClientMessage(
    JSON.stringify({ type: "CONNECT", pseudo: "Alice" }),
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.message.type, ClientMessageType.Connect);
});

test("rejette un CONNECT sans pseudo", () => {
  const r = parseClientMessage(JSON.stringify({ type: "CONNECT" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, ErrorCode.InvalidPayload);
});

test("rejette un MOVE avec coordonnées non numériques", () => {
  const r = parseClientMessage(
    JSON.stringify({ type: "MOVE", x: "10", y: 5 }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, ErrorCode.InvalidPayload);
});

test("rejette un GAIN_XP_DEBUG négatif", () => {
  const r = parseClientMessage(
    JSON.stringify({ type: "GAIN_XP_DEBUG", amount: -5 }),
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, ErrorCode.InvalidPayload);
});

test("JSON malformé => MALFORMED_JSON", () => {
  const r = parseClientMessage("not-json");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, ErrorCode.MalformedJson);
});

test("payload non-objet (tableau) => INVALID_PAYLOAD", () => {
  const r = parseClientMessage(JSON.stringify([1, 2, 3]));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, ErrorCode.InvalidPayload);
});

test("type inconnu => UNKNOWN_TYPE", () => {
  const r = parseClientMessage(JSON.stringify({ type: "DANCE" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, ErrorCode.UnknownType);
});
