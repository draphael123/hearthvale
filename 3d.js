// Hearthvale 3D proof-of-concept.
// Reuses the real game board + the existing 2D tile art (drawTileBase) as
// textures on 3D hex prisms, lit with a real sun + shadows. No props/HUD yet —
// this just proves the core "our tiles, but actually 3D" look.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { newGame, place } from '/src/game.js';
import { drawTileBase, hashCoord } from '/src/art.js';
import { setRng } from '/src/tiles.js';
import { SQRT3 } from '/src/hex.js';

// ---- 1) Build a sample board from the real game logic ----
setRng(Math.random);
const g = newGame(['forest', 'field', 'water', 'village', 'mountain', 'coast']);
const key = (q, r) => q + ',' + r;
const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
function openSlots() {
  const m = new Map();
  for (const t of g.board.values()) for (const [dq, dr] of DIRS) {
    const nq = t.q + dq, nr = t.r + dr;
    if (!g.board.has(key(nq, nr))) m.set(key(nq, nr), { q: nq, r: nr });
  }
  return [...m.values()];
}
for (let i = 0; i < 70; i++) { const s = openSlots(); if (!s.length) break; place(g, s[0].q, s[0].r); }

// ---- 2) Three.js scene ----
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#aacbe6');
scene.fog = new THREE.Fog('#aacbe6', 34, 105);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 500);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;   // can't go under the board
controls.minDistance = 6;
controls.maxDistance = 70;

// ---- 3) Lights ----
scene.add(new THREE.HemisphereLight('#d6e8f5', '#52603f', 0.95));
const sun = new THREE.DirectionalLight('#fff4da', 1.55);
sun.position.set(-20, 30, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SD = 34;
Object.assign(sun.shadow.camera, { left: -SD, right: SD, top: SD, bottom: -SD, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// soft ground plane under the vale (catches shadow, suggests surrounding land)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: '#415d36', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.22;
ground.receiveShadow = true;
scene.add(ground);

// ---- 4) Hex prism geometry (top UVs mapped exactly to the tile-art hexagon) ----
const S = 1.0;          // hex circumradius (world units)
const HGT = 0.42;       // prism thickness
const TEX = 256;        // tile texture resolution
const TEXR = 0.49;      // hexagon radius inside the texture (and matching UV)

function hexPrismGeometry(s, h) {
  const pos = [], uv = [], idx = [];
  const corners = [];
  for (let k = 0; k < 6; k++) { const a = (Math.PI / 180) * (60 * k - 30); corners.push([Math.cos(a) * s, Math.sin(a) * s]); }
  // TOP face — triangle fan (center + 6 corners), UVs match the drawn hexagon.
  pos.push(0, h / 2, 0); uv.push(0.5, 0.5);
  for (const [cx, cz] of corners) { pos.push(cx, h / 2, cz); uv.push(0.5 + TEXR * (cx / s), 0.5 + TEXR * (cz / s)); }
  for (let k = 0; k < 6; k++) idx.push(0, 1 + k, 1 + ((k + 1) % 6));
  const topCount = idx.length;
  // SIDES — a quad per edge (separate verts for flat normals).
  const base = pos.length / 3;
  for (const [cx, cz] of corners) {
    pos.push(cx, h / 2, cz); uv.push(0, 0);
    pos.push(cx, -h / 2, cz); uv.push(0, 1);
  }
  for (let k = 0; k < 6; k++) {
    const a = base + k * 2, b = base + ((k + 1) % 6) * 2;
    idx.push(a, b, b + 1); idx.push(a, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.addGroup(0, topCount, 1);                  // material 1 = top (tile art)
  geo.addGroup(topCount, idx.length - topCount, 0); // material 0 = side
  return geo;
}
const prismGeo = hexPrismGeometry(S, HGT);
const sideMat = new THREE.MeshStandardMaterial({ color: '#6a513a', roughness: 1 });

function tileTexture(tile) {
  const cv = document.createElement('canvas'); cv.width = TEX; cv.height = TEX;
  const ctx = cv.getContext('2d');
  drawTileBase(ctx, TEX / 2, TEX / 2, TEX * TEXR, tile.edges, hashCoord(tile.q, tile.r), tile.landmark, null);
  const tx = new THREE.CanvasTexture(cv);
  tx.flipY = false;                 // sample canvas pixels directly (matches our UVs)
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tx;
}

// ---- 5a) Prop templates (cloned per placement; share geometry + material) ----
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shadowy = (o) => { o.traverse(m => { m.castShadow = true; m.receiveShadow = true; }); return o; };

const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a3d22', roughness: 1 });
const leafMats = ['#2f6a2c', '#357a32', '#46863f', '#5b8c3a'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
const wallMats = ['#e6d6b8', '#dcc6a0', '#ece2cc', '#d9c4a4'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
const roofMats = ['#b14f33', '#9c4429', '#7c5a3c', '#6f8190'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
const stoneMat = new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 1 });

const TREE = shadowy((() => {
  const grp = new THREE.Group();
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.22, 5), trunkMat); tr.position.y = 0.11;
  const cn = new THREE.Mesh(new THREE.IcosahedronGeometry(0.21, 0), leafMats[0]); cn.position.y = 0.36; cn.scale.y = 1.15;
  grp.add(tr, cn); return grp;
})());
const HOUSE = shadowy((() => {
  const grp = new THREE.Group();
  const w = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.3), wallMats[0]); w.position.y = 0.14;
  const r = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.24, 4), roofMats[0]); r.position.y = 0.4; r.rotation.y = Math.PI / 4;
  grp.add(w, r); return grp;
})());
const PEAK = shadowy(new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.62, 6), stoneMat));
PEAK.position.y = 0.31;
const KEEP = shadowy((() => {
  const grp = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), stoneMat); base.position.y = 0.2;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.46, 6), stoneMat); tower.position.y = 0.62;
  grp.add(base, tower); return grp;
})());

const topY = HGT / 2;
function addProps(tile, wx, wz) {
  const rng = mulberry32((hashCoord(tile.q, tile.r) ^ 0x5bd1e995) >>> 0);
  const drop = (tmpl, angDeg, rad, s) => {
    const o = tmpl.clone();
    const a = angDeg * Math.PI / 180;
    o.position.set(wx + Math.cos(a) * rad * S, topY, wz + Math.sin(a) * rad * S);
    o.scale.setScalar(s);
    o.rotation.y = rng() * Math.PI * 2;
    scene.add(o);
    return o;
  };
  for (let i = 0; i < 6; i++) {
    const e = tile.edges[i], ang = 60 * i + (rng() * 24 - 12);
    if (e === 'forest') {
      const n = 1 + (rng() < 0.5 ? 1 : 0);
      for (let j = 0; j < n; j++) { const t = drop(TREE, ang + rng() * 20 - 10, 0.34 + rng() * 0.3, 0.8 + rng() * 0.5); t.children[1].material = leafMats[(rng() * leafMats.length) | 0]; }
    } else if (e === 'village') {
      if (rng() < 0.7) { const h = drop(HOUSE, ang, 0.3 + rng() * 0.22, 0.85 + rng() * 0.4); h.children[0].material = wallMats[(rng() * wallMats.length) | 0]; h.children[1].material = roofMats[(rng() * roofMats.length) | 0]; }
    } else if (e === 'mountain') {
      if (rng() < 0.6) drop(PEAK, ang, 0.18 + rng() * 0.3, 0.7 + rng() * 0.6);
    }
  }
  if (tile.landmark) { const o = KEEP.clone(); o.position.set(wx, topY, wz); o.scale.setScalar(0.95); scene.add(o); }
}

// ---- 5) Place a prism + props per tile ----
let cx = 0, cz = 0, n = 0;
for (const tile of g.board.values()) {
  const top = new THREE.MeshStandardMaterial({ map: tileTexture(tile), roughness: 0.92, transparent: true, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(prismGeo, [sideMat, top]);
  const wx = SQRT3 * (tile.q + tile.r / 2) * S;
  const wz = 1.5 * tile.r * S;
  mesh.position.set(wx, 0, wz);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  addProps(tile, wx, wz);
  cx += wx; cz += wz; n++;
}

// ---- 6) Frame the camera on the board centroid ----
const ctr = new THREE.Vector3(cx / n, 0, cz / n);
controls.target.copy(ctr);
camera.position.set(ctr.x, 20, ctr.z + 24);
sun.target.position.copy(ctr);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
}
loop();

// expose for headless inspection
window.__three = { THREE, scene, camera, renderer, controls, tiles: g.board.size };
window.__threeReady = true;
