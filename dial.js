// Shared dial logic used by both the background script and the GM panel.
import OBR, { buildShape, buildText } from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm";

export { OBR };
export const ID = "com.dial-lock";
export const DIAL = `${ID}/dial`; // metadata on the dial body: { symbols, pos }
export const PART = `${ID}/part`; // metadata on attached pieces: { kind, index? }
export const TURN = `${ID}/turn`; // broadcast channel for turn requests

export const PRESETS = {
  Runes: ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ"],
  Zodiac: ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"],
  Moons: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
  Elements: ["🔥", "💧", "🌍", "💨"],
  Celestial: ["☀", "☾", "★", "☄"],
  Numbers: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
};

export const isDial = (item) => item.type === "SHAPE" && !!item.metadata?.[DIAL];
export const mod = (a, n) => ((a % n) + n) % n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => 1 - Math.pow(1 - t, 3);

// Rotate (x, y) clockwise by `deg` degrees (screen coordinates, y down).
function rot(deg, x, y) {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

const symbolSize = (D, n) => Math.min(D * 0.24, ((2 * Math.PI * D * 0.36) / n) * 0.85);
const angleFor = (pos, n) => (-pos * 360) / n;

// Position + rotation for every symbol when the dial is turned to `theta` degrees.
function layout(center, D, n, theta) {
  const r = D * 0.36;
  const s = symbolSize(D, n);
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 360) / n + theta;
    const p = rot(a, 0, -r);
    const off = rot(a, s / 2, s / 2); // text items rotate around their top-left corner
    return { position: { x: center.x + p.x - off.x, y: center.y + p.y - off.y }, rotation: a };
  });
}

function buildParts(body) {
  const { symbols, pos } = body.metadata[DIAL];
  const D = body.width;
  const C = body.position;
  const n = symbols.length;
  const z = body.zIndex;
  const part = (builder, kind, zOffset, extra = {}) =>
    builder
      .attachedTo(body.id)
      .layer(body.layer)
      .locked(true)
      .disableHit(true)
      .visible(body.visible)
      .disableAttachmentBehavior(["ROTATION", "SCALE"])
      .disableAutoZIndex(true)
      .zIndex(z + zOffset)
      .metadata({ [PART]: { kind, ...extra } })
      .build();

  const parts = [
    part(buildShape().shapeType("CIRCLE").width(D * 0.86).height(D * 0.86).position(C)
      .fillOpacity(0).strokeColor("#8a8fae").strokeWidth(D * 0.012).name("Dial ring"), "ring", 1),
    part(buildShape().shapeType("CIRCLE").width(D * 0.24).height(D * 0.24).position(C)
      .fillColor("#6b6f88").strokeColor("#23263a").strokeWidth(D * 0.02).name("Dial hub"), "hub", 2),
  ];

  if (n) {
    const s = symbolSize(D, n);
    const L = layout(C, D, n, angleFor(pos, n));
    symbols.forEach((sym, i) => {
      parts.push(part(
        buildText().plainText(sym).textType("PLAIN").width(s).height(s).padding(0)
          .fontSize(s * 0.7).textAlign("CENTER").textAlignVertical("MIDDLE")
          .fillColor("#ffffff").strokeColor("#000000").strokeWidth(Math.max(1, s * 0.04))
          .position(L[i].position).rotation(L[i].rotation).name(`Dial symbol ${sym}`),
        "symbol", 3, { index: i }));
    });
  }

  const p = D * 0.2;
  parts.push(part(
    buildText().plainText("▼").textType("PLAIN").width(p).height(p).padding(0)
      .fontSize(p * 0.8).textAlign("CENTER").textAlignVertical("MIDDLE")
      .fillColor("#f2c14e").strokeColor("#000000").strokeWidth(Math.max(1, p * 0.05))
      .position({ x: C.x - p / 2, y: C.y - D / 2 - p * 0.75 }).name("Dial pointer"),
    "pointer", 4));
  return parts;
}

export async function getParts(id) {
  const items = await OBR.scene.items.getItemAttachments([id]);
  return items.filter((i) => i.id !== id && i.metadata?.[PART]);
}

export async function createDial(center, symbols = PRESETS.Celestial) {
  const D = (await OBR.scene.grid.getDpi()) * 3;
  const body = buildShape().shapeType("CIRCLE").width(D).height(D).position(center)
    .fillColor("#3b3f56").strokeColor("#1b1d2b").strokeWidth(D * 0.04)
    .layer("PROP").locked(false).name("Dial").disableAutoZIndex(true).zIndex(Date.now())
    .metadata({ [DIAL]: { symbols: [...symbols], pos: 0 } })
    .build();
  await OBR.scene.items.addItems([body, ...buildParts(body)]);
  return body.id;
}

// Change symbols and/or size, then rebuild the attached pieces.
export async function editDial(id, { symbols, squares } = {}) {
  const [body] = await OBR.scene.items.getItems([id]);
  if (!body) return;
  const data = { ...body.metadata[DIAL] };
  if (symbols) {
    const cur = data.symbols.length ? mod(data.pos, data.symbols.length) : 0;
    data.symbols = symbols;
    data.pos = symbols.length ? Math.min(cur, symbols.length - 1) : 0;
  }
  const D = squares ? (await OBR.scene.grid.getDpi()) * squares : body.width;
  await OBR.scene.items.updateItems([id], ([d]) => {
    d.metadata[DIAL] = data;
    d.width = D;
    d.height = D;
    d.style.strokeWidth = D * 0.04;
  });
  const [fresh] = await OBR.scene.items.getItems([id]);
  const old = await getParts(id);
  await OBR.scene.items.deleteItems(old.map((p) => p.id));
  await OBR.scene.items.addItems(buildParts(fresh));
}

export async function setDialProps(id, { visible, locked, name }) {
  const ids = [id];
  if (visible !== undefined) ids.push(...(await getParts(id)).map((p) => p.id));
  await OBR.scene.items.updateItems(ids, (drafts) => {
    for (const d of drafts) {
      if (visible !== undefined) d.visible = visible;
      if (d.id !== id) continue;
      if (locked !== undefined) d.locked = locked;
      if (name !== undefined) d.name = name;
    }
  });
}

// Turns run one at a time per dial so rapid clicks all count.
const queues = {};
export function turn(id, delta) {
  queues[id] = (queues[id] || Promise.resolve()).then(() => doTurn(id, delta)).catch(console.error);
  return queues[id];
}

async function doTurn(id, delta) {
  const [body] = await OBR.scene.items.getItems([id]);
  if (!body) return;
  const data = body.metadata[DIAL];
  const n = data.symbols.length;
  if (!n) return;
  const from = data.pos;
  const to = from + delta;
  await OBR.scene.items.updateItems([id], ([d]) => { d.metadata[DIAL] = { ...data, pos: to }; });

  const ids = (await getParts(id)).filter((p) => p.metadata[PART].kind === "symbol").map((p) => p.id);
  const FRAMES = 5;
  for (let f = 1; f <= FRAMES; f++) {
    const L = layout(body.position, body.width, n, angleFor(from + (to - from) * ease(f / FRAMES), n));
    await OBR.scene.items.updateItems(ids, (drafts) => {
      for (const d of drafts) {
        const k = d.metadata[PART].index;
        d.position = L[k].position;
        d.rotation = L[k].rotation;
      }
    });
    if (f < FRAMES) await sleep(30);
  }
}

// Anyone can ask for a turn; exactly one GM (lowest connection id) performs it,
// so players don't need permission to edit scene items.
export function requestTurn(id, delta) {
  return OBR.broadcast.sendMessage(TURN, { id, delta }, { destination: "ALL" });
}

export async function isPrimaryGM() {
  if ((await OBR.player.getRole()) !== "GM") return false;
  const me = await OBR.player.getConnectionId();
  const gms = (await OBR.party.getPlayers()).filter((p) => p.role === "GM").map((p) => p.connectionId);
  return gms.every((c) => me <= c);
}
