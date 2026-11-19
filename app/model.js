// 3D body viewer: BodyParts3D muscles from data/model.bin, GPU picking, renders only while something changes.
import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/OrbitControls.js";

const CLR = { rest: 0xc9aea2, ctx: 0xb7a59d, bone: 0xe4dccb, hover: 0xe58d74 };
const VIEWS = { front: [0, 0, 3.9], back: [0, 0, -3.9], side: [3.9, 0, 0] };
let modelData = null;   // fetched once per page load: [manifest, ArrayBuffer]

function loadModel() {
  modelData ??= Promise.all([
    fetch("data/model.json").then(r => r.json()),
    fetch("data/model.bin").then(r => { if (!r.ok) throw new Error(`model ${r.status}`); return r.arrayBuffer(); }),
  ]).catch(err => { modelData = null; throw err; });
  return modelData;
}

export function createBodyViewer(container, { onHover = () => {}, onToggle = () => {} } = {}) {
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.append(renderer.domElement);
  const el = renderer.domElement;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  const controls = new OrbitControls(camera, el);
  controls.enableDamping = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.minDistance = 0.6;
  controls.maxDistance = 6;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(1.5, 2.5, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-2, 1, -3); scene.add(rim);

  const regionMesh = new Map();
  const pickables = [];
  let selected = new Set();
  let hovered = null;
  let dirty = true;

  const accent = () => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  function paint() {
    const a = accent();
    for (const [id, m] of regionMesh) m.material.color.set(selected.has(id) ? a : id === hovered ? CLR.hover : CLR.rest);
    dirty = true;
  }

  function resize() {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  function setView(name) {
    controls.target.set(0, 0, 0);
    camera.position.set(...VIEWS[name]);
    controls.update();
    dirty = true;
  }

  // GPU picking: draw region ids into a 1x1 target under the pointer
  const pickRT = new THREE.WebGLRenderTarget(1, 1);
  const pickBuf = new Uint8Array(4);
  function pickAt(clientX, clientY) {
    if (!pickables.length) return null;
    const r = el.getBoundingClientRect();
    const dpr = renderer.getPixelRatio();
    camera.setViewOffset(r.width * dpr, r.height * dpr, Math.floor((clientX - r.left) * dpr), Math.floor((clientY - r.top) * dpr), 1, 1);
    const saved = pickables.map(m => m.material);
    pickables.forEach(m => { m.material = m.userData.pickMat; });
    renderer.setRenderTarget(pickRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
    renderer.setRenderTarget(null);
    pickables.forEach((m, i) => { m.material = saved[i]; });
    camera.clearViewOffset();
    dirty = true;
    return pickables[Math.round(pickBuf[0] / 8) - 1]?.userData.region ?? null;
  }

  let downAt = null;
  let moveQueued = 0;
  const onDown = e => { downAt = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 6) return;   // that was a drag to rotate
    const id = pickAt(e.clientX, e.clientY);
    if (id) onToggle(id);
    if (!canHover) onHover(id, null, null);
  };
  const onMove = e => {
    if (e.buttons) return onHover(null, null, null);
    if (moveQueued) return;
    moveQueued = requestAnimationFrame(() => {
      moveQueued = 0;
      const id = pickAt(e.clientX, e.clientY);
      if (id !== hovered) { hovered = id; paint(); }
      el.style.cursor = id ? "pointer" : "grab";
      onHover(id, e.clientX, e.clientY);
    });
  };
  const onLeave = () => { hovered = null; paint(); onHover(null, null, null); };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  if (canHover) { el.addEventListener("pointermove", onMove); el.addEventListener("pointerleave", onLeave); }
  el.style.touchAction = "none";
  controls.addEventListener("change", () => { dirty = true; });

  document.addEventListener("themechange", paint);

  resize();
  setView("front");
  renderer.setAnimationLoop(() => {
    if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; }
  });

  const ready = loadModel().then(([man, bin]) => {
    for (const p of man.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Int16Array(bin, p.pos[0], p.pos[1] * 3), 3));
      const I = p.idx[2] === "u32" ? Uint32Array : Uint16Array;
      g.setIndex(new THREE.BufferAttribute(new I(bin, p.idx[0], p.idx[1]), 1));
      g.computeVertexNormals();
      const base = p.id === "ctx_bone" ? CLR.bone : p.id === "ctx_muscle" ? CLR.ctx : CLR.rest;
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: base, roughness: p.id === "ctx_bone" ? 0.85 : 0.6 }));
      m.scale.setScalar(man.unit);
      pickables.push(m);
      m.userData.pickMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(pickables.length * 8 / 255, 0, 0, THREE.LinearSRGBColorSpace) });
      if (!p.id.startsWith("ctx_")) { m.userData.region = p.id; regionMesh.set(p.id, m); }
      scene.add(m);
    }
    paint();
  });

  return {
    ready,
    setSelected(ids) { selected = new Set(ids); paint(); },
    setHover(id) { hovered = id; paint(); },
    setView,
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      document.removeEventListener("themechange", paint);
      cancelAnimationFrame(moveQueued);
      controls.dispose();
      for (const m of pickables) { m.geometry.dispose(); m.material.dispose(); m.userData.pickMat.dispose(); }
      pickRT.dispose();
      renderer.dispose();
      el.remove();
    },
  };
}
