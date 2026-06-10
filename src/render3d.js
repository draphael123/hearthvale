// Hearthvale 3D renderer — drop-in board renderer that mirrors the live game
// state as 3D hex prisms (top face = the existing 2D tile art) with real sun +
// shadows, a simple orbit camera, a ghost preview tile, and raycast picking.
// The 2D HUD/menus are still drawn on a separate canvas layered on top.

import * as THREE from '/lib/three.module.js';
import { drawTileBase, hashCoord } from './art.js';
import { SQRT3, key, neighbor } from './hex.js';
import { pixelToHex } from './hex.js';
import { currentEdges, openSlots } from './game.js';

const S = 1.0, HGT = 0.42, TEX = 256, TEXR = 0.49;
const topY = HGT / 2;

let renderer, scene, camera, sun;
let ready = false;
const tiles = new Map();          // key -> { group }
let slotGroup, ghostGroup, ghostTex = null, ghostKey = '';
// orbit camera state
const target = new THREE.Vector3();
let radius = 22, azimuth = Math.PI / 2, polar = 0.85;

const worldX = (q, r) => SQRT3 * (q + r / 2) * S;
const worldZ = (q, r) => 1.5 * r * S;

// ---------- geometry + materials ----------
function hexPrismGeometry(s, h) {
  const pos = [], uv = [], idx = [];
  const c = [];
  for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k - 30); c.push([Math.cos(a) * s, Math.sin(a) * s]); }
  pos.push(0, h / 2, 0); uv.push(0.5, 0.5);
  for (const [x, z] of c) { pos.push(x, h / 2, z); uv.push(0.5 + TEXR * (x / s), 0.5 + TEXR * (z / s)); }
  for (let k = 0; k < 6; k++) idx.push(0, 1 + k, 1 + ((k + 1) % 6));
  const topCount = idx.length;
  const base = pos.length / 3;
  for (const [x, z] of c) { pos.push(x, h / 2, z); uv.push(0, 0); pos.push(x, -h / 2, z); uv.push(0, 1); }
  for (let k = 0; k < 6; k++) { const a = base + k * 2, b = base + ((k + 1) % 6) * 2; idx.push(a, b, b + 1); idx.push(a, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.addGroup(0, topCount, 1); g.addGroup(topCount, idx.length - topCount, 0);
  return g;
}
let prismGeo, sideMat;
let trunkMat, leafMats, wallMats, roofMats, stoneMat;
let TREE, HOUSE, PEAK, KEEP;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shadowy = (o) => { o.traverse(m => { m.castShadow = true; m.receiveShadow = true; }); return o; };

function buildTemplates() {
  prismGeo = hexPrismGeometry(S, HGT);
  sideMat = new THREE.MeshStandardMaterial({ color: '#6a513a', roughness: 1 });
  trunkMat = new THREE.MeshStandardMaterial({ color: '#5a3d22', roughness: 1 });
  leafMats = ['#2f6a2c', '#357a32', '#46863f', '#5b8c3a'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  wallMats = ['#e6d6b8', '#dcc6a0', '#ece2cc', '#d9c4a4'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  roofMats = ['#b14f33', '#9c4429', '#7c5a3c', '#6f8190'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  stoneMat = new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 1 });
  TREE = shadowy((() => { const g = new THREE.Group(); const t = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.22, 5), trunkMat); t.position.y = 0.11; const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), leafMats[0]); c.position.y = 0.36; c.scale.y = 1.15; g.add(t, c); return g; })());
  HOUSE = shadowy((() => { const g = new THREE.Group(); const w = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.3), wallMats[0]); w.position.y = 0.14; const r = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 4), roofMats[0]); r.position.y = 0.4; r.rotation.y = Math.PI / 4; g.add(w, r); return g; })());
  PEAK = shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.62, 6), stoneMat)); PEAK.position.y = 0.31;
  KEEP = shadowy((() => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), stoneMat); b.position.y = 0.2; const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.46, 6), stoneMat); t.position.y = 0.62; g.add(b, t); return g; })());
}

function tileCanvas(edges, q, r, landmark) {
  const cv = document.createElement('canvas'); cv.width = TEX; cv.height = TEX;
  drawTileBase(cv.getContext('2d'), TEX / 2, TEX / 2, TEX * TEXR, edges, hashCoord(q, r), landmark, null);
  const tx = new THREE.CanvasTexture(cv);
  tx.flipY = false; tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tx;
}

function addProps(grp, tile) {
  const rng = mulberry32((hashCoord(tile.q, tile.r) ^ 0x5bd1e995) >>> 0);
  const drop = (tmpl, angDeg, rad, s) => { const o = tmpl.clone(); const a = angDeg * Math.PI / 180; o.position.set(Math.cos(a) * rad * S, topY, Math.sin(a) * rad * S); o.scale.setScalar(s); o.rotation.y = rng() * Math.PI * 2; grp.add(o); return o; };
  for (let i = 0; i < 6; i++) {
    const e = tile.edges[i], ang = 60 * i + (rng() * 24 - 12);
    if (e === 'forest') { const n = 1 + (rng() < 0.5 ? 1 : 0); for (let j = 0; j < n; j++) { const t = drop(TREE, ang + rng() * 20 - 10, 0.34 + rng() * 0.3, 0.8 + rng() * 0.5); t.children[1].material = leafMats[(rng() * leafMats.length) | 0]; } }
    else if (e === 'village') { if (rng() < 0.7) { const h = drop(HOUSE, ang, 0.3 + rng() * 0.22, 0.85 + rng() * 0.4); h.children[0].material = wallMats[(rng() * wallMats.length) | 0]; h.children[1].material = roofMats[(rng() * roofMats.length) | 0]; } }
    else if (e === 'mountain') { if (rng() < 0.6) drop(PEAK, ang, 0.18 + rng() * 0.3, 0.7 + rng() * 0.6); }
  }
  if (tile.landmark) { const o = KEEP.clone(); o.position.set(0, topY, 0); o.scale.setScalar(0.95); grp.add(o); }
}

function addTile(tile) {
  const grp = new THREE.Group();
  const top = new THREE.MeshStandardMaterial({ map: tileCanvas(tile.edges, tile.q, tile.r, tile.landmark), roughness: 0.92, transparent: true, alphaTest: 0.5 });
  const prism = new THREE.Mesh(prismGeo, [sideMat, top]);
  prism.castShadow = true; prism.receiveShadow = true;
  grp.add(prism);
  addProps(grp, tile);
  grp.position.set(worldX(tile.q, tile.r), 0, worldZ(tile.q, tile.r));
  scene.add(grp);
  tiles.set(key(tile.q, tile.r), { group: grp, townTier: tile.townSize ? Math.min(3, tile.townSize) : 0 });
}

// ---------- public API ----------
export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#aacbe6');
  scene.fog = new THREE.Fog('#aacbe6', 34, 110);
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  scene.add(new THREE.HemisphereLight('#d6e8f5', '#52603f', 0.95));
  sun = new THREE.DirectionalLight('#fff4da', 1.55);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  const SDc = 36; Object.assign(sun.shadow.camera, { left: -SDc, right: SDc, top: SDc, bottom: -SDc, near: 1, far: 130 });
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: '#415d36', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.22; ground.receiveShadow = true; scene.add(ground);
  buildTemplates();
  slotGroup = new THREE.Group(); scene.add(slotGroup);
  ready = true;
}

export function isReady() { return ready; }

export function resize(w, h) {
  if (!ready) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

// Rebuild meshes for any newly placed tiles; reframe on first sync.
let framed = false;
export function syncBoard(g) {
  if (!ready) return;
  // add new tiles
  for (const tile of g.board.values()) {
    const k = key(tile.q, tile.r);
    const cur = tiles.get(k);
    const tier = tile.townSize ? Math.min(3, tile.townSize) : 0;
    if (!cur) addTile(tile);
    else if (cur.townTier !== tier) { scene.remove(cur.group); disposeGroup(cur.group); tiles.delete(k); addTile(tile); } // town grew -> rebuild
  }
  if (!framed && tiles.size) { frameBoard(g); framed = true; }
}

function disposeGroup(grp) { grp.traverse(o => { if (o.isMesh && o.material && o.material.map) o.material.map.dispose(); }); }

function frameBoard(g) {
  let cx = 0, cz = 0, n = 0;
  for (const t of g.board.values()) { cx += worldX(t.q, t.r); cz += worldZ(t.q, t.r); n++; }
  if (n) target.set(cx / n, 0, cz / n);
  radius = Math.max(16, Math.sqrt(n) * 3.2);
}

// Ghost preview: float the current tile above a hovered slot.
export function setGhost(g, slot) {
  if (!ready) return;
  if (!slot || !g.current) { if (ghostGroup) ghostGroup.visible = false; ghostKey = ''; return; }
  const edges = currentEdges(g);
  const k = key(slot.q, slot.r) + '|' + edges.join('') + '|' + (g.current.landmark || '');
  if (!ghostGroup) { ghostGroup = new THREE.Group(); scene.add(ghostGroup); }
  if (k !== ghostKey) {
    // rebuild ghost contents
    for (let i = ghostGroup.children.length - 1; i >= 0; i--) ghostGroup.remove(ghostGroup.children[i]);
    if (ghostTex) ghostTex.dispose();
    ghostTex = tileCanvas(edges, slot.q, slot.r, g.current.landmark);
    const top = new THREE.MeshStandardMaterial({ map: ghostTex, roughness: 0.92, transparent: true, opacity: 0.85, alphaTest: 0.4 });
    const prism = new THREE.Mesh(prismGeo, [sideMat, top]);
    ghostGroup.add(prism);
    ghostKey = k;
  }
  ghostGroup.visible = true;
  ghostGroup.position.set(worldX(slot.q, slot.r), 0.5, worldZ(slot.q, slot.r));
}

// Subtle ring markers on the open slots so the player sees where to place.
let slotRingGeo, slotRingMat;
export function showSlots(g) {
  if (!ready) return;
  for (let i = slotGroup.children.length - 1; i >= 0; i--) slotGroup.remove(slotGroup.children[i]);
  if (g.gameOver) return;
  if (!slotRingGeo) { slotRingGeo = new THREE.RingGeometry(S * 0.5, S * 0.62, 6); slotRingMat = new THREE.MeshBasicMaterial({ color: '#cfe6a8', transparent: true, opacity: 0.4, side: THREE.DoubleSide }); }
  for (const s of openSlots(g).values()) {
    const m = new THREE.Mesh(slotRingGeo, slotRingMat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 6;
    m.position.set(worldX(s.q, s.r), HGT / 2 + 0.02, worldZ(s.q, s.r));
    slotGroup.add(m);
  }
}

// ---------- camera ----------
function updateCamera() {
  const sp = Math.sin(polar), cp = Math.cos(polar);
  camera.position.set(target.x + radius * sp * Math.sin(azimuth), target.y + radius * cp, target.z + radius * sp * Math.cos(azimuth));
  camera.lookAt(target);
  // sun follows roughly so shadows stay sensible
  sun.position.set(target.x - 22, target.y + 32, target.z + 16);
  sun.target.position.copy(target);
}
export function orbit(dAz, dPolar) { azimuth -= dAz; polar = Math.max(0.18, Math.min(1.45, polar - dPolar)); }
export function zoom(factor) { radius = Math.max(8, Math.min(80, radius * factor)); }
export function panCam(dx, dy) {
  const right = new THREE.Vector3(Math.cos(azimuth), 0, -Math.sin(azimuth));
  const fwd = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
  target.addScaledVector(right, -dx * radius * 0.0016);
  target.addScaledVector(fwd, dy * radius * 0.0016);
}

// ---------- picking ----------
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -topY);
const _pt = new THREE.Vector3();
// nx, ny are normalized device coords in [-1,1]
export function pickHex(nx, ny) {
  if (!ready) return null;
  _ray.setFromCamera({ x: nx, y: ny }, camera);
  if (!_ray.ray.intersectPlane(_plane, _pt)) return null;
  return pixelToHex(_pt.x, _pt.z, S);   // worldX/worldZ use the same form as hexToPixel(size=S)
}

export function frame() {
  if (!ready) return;
  updateCamera();
  renderer.render(scene, camera);
}

// Wipe the whole board (on restart / new run).
export function clearBoard() {
  if (!ready) return;
  for (const { group } of tiles.values()) { scene.remove(group); disposeGroup(group); }
  tiles.clear();
  if (ghostGroup) { ghostGroup.visible = false; ghostKey = ''; }
  for (let i = slotGroup.children.length - 1; i >= 0; i--) slotGroup.remove(slotGroup.children[i]);
  framed = false;
}
