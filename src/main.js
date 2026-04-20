import "./styles.css";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import * as CANNON from "cannon-es";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TOP_FACE_INDEX = 2; // +Y local = top face when die rests flat
const TAU = Math.PI * 2;

const palettes = [
  {
    primary: "#74f8ff",
    secondary: "#16a6ff",
    edge: "#6efbff",
    dark: "#031019",
  },
  {
    primary: "#ffcf56",
    secondary: "#ff4f93",
    edge: "#ff8eef",
    dark: "#19080f",
  },
];

const canvas = document.querySelector("#scene");
const app = document.querySelector("#app");
const rollButton = document.querySelector("#rollButton");
const leftLetter = document.querySelector("#leftLetter");
const rightLetter = document.querySelector("#rightLetter");
const statusText = document.querySelector("#statusText");
const jackpotPanel = document.querySelector("#jackpot");
const screenFlash = document.querySelector("#screenFlash");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color("#050816");
scene.fog = new THREE.Fog("#050816", 11, 28);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 2.2, 10.8);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.25, 0.85, 0.38);
bloomPass.threshold = 0.14;
bloomPass.strength = 0.92;
bloomPass.radius = 0.62;
composer.addPass(bloomPass);

const clock = new THREE.Clock();
const viewRotation = {
  dragging: false,
  yaw: 0,
  pitch: -0.06,
  velocityYaw: 0,
  velocityPitch: 0,
  lastX: 0,
  lastY: 0,
};

let rollState = null;
let missStreak = 0;
let jackpotTimeout = null;
let flashTimeout = null;
let jackpotPulse = 0;

const LAND_Y = 0.95;
// PHYS_FLOOR_Y: cannon body center at rest = LAND_Y + 0.42(cube local y) = 1.37; bottom = 1.37-1 = 0.37
const PHYS_FLOOR_Y = 0.37;
const shockwaves = [];
const cameraShake = { power: 0 };

// ─── cannon-es physics world ──────────────────────────────────────
const physWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
physWorld.broadphase = new CANNON.NaiveBroadphase();
physWorld.allowSleep = true;
physWorld.sleepSpeedLimit = 0.18;
physWorld.sleepTimeLimit = 0.35;

const physFloorMat = new CANNON.Material("floor");
const physDieMat = new CANNON.Material("die");
physWorld.addContactMaterial(
  new CANNON.ContactMaterial(physFloorMat, physDieMat, {
    friction: 0.55,
    restitution: 0.46,
  }),
);

const physFloor = new CANNON.Body({ mass: 0, material: physFloorMat });
physFloor.addShape(new CANNON.Plane());
physFloor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
physFloor.position.y = PHYS_FLOOR_Y;
physWorld.addBody(physFloor);

// Side walls to keep dice on stage
[9, -9].forEach((xPos) => {
  const wall = new CANNON.Body({ mass: 0 });
  wall.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 5, 10)));
  wall.position.set(xPos, 3, 0);
  physWorld.addBody(wall);
});
// ─────────────────────────────────────────────────────────────────

const world = new THREE.Group();
scene.add(world);

const environment = buildEnvironment();
const dice = [
  createDie(-2.35, palettes[0], 0),
  createDie(2.35, palettes[1], 1.4),
];
const burst = createBurst();

rollButton.addEventListener("click", startRoll);

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    startRoll();
  }
});

canvas.addEventListener("pointerdown", beginViewportDrag);
canvas.addEventListener("pointermove", updateViewportDrag);
canvas.addEventListener("pointerup", endViewportDrag);
canvas.addEventListener("pointercancel", endViewportDrag);

setResult("?", "?");
setStatus("点击按钮，启动双骰霓虹引擎。");
window.addEventListener("resize", onResize);
onResize();

// Wait for web fonts before creating face textures (avoids blank-face bug)
document.fonts.ready.then(() => {
  dice.forEach((die) => applyFaces(die, randomFaceSet(randomLetter())));
  animate();
});

function buildEnvironment() {
  const ambient = new THREE.HemisphereLight("#78ecff", "#050816", 0.9);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight("#ffffff", 0.85);
  sun.position.set(0, 7, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  scene.add(sun);

  const frontFill = new THREE.DirectionalLight("#eaf6ff", 0.92);
  frontFill.position.set(0, 4.5, 8.6);
  scene.add(frontFill);

  const leftLight = new THREE.PointLight("#00e6ff", 18, 18, 2);
  leftLight.position.set(-5.5, 2.6, 2.5);
  scene.add(leftLight);

  const rightLight = new THREE.PointLight("#ff5ab7", 16, 18, 2);
  rightLight.position.set(5.5, 2.8, 2.5);
  scene.add(rightLight);

  const backLight = new THREE.PointLight("#77ffcc", 8, 22, 2);
  backLight.position.set(0, 4.5, -6);
  scene.add(backLight);

  const topLight = new THREE.PointLight("#c97aff", 9, 16, 2);
  topLight.position.set(0, 7.5, 3);
  scene.add(topLight);

  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(8.4, 9.2, 0.65, 72),
    new THREE.MeshPhysicalMaterial({
      color: "#060812",
      metalness: 0.88,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.22,
      emissive: "#081526",
      emissiveIntensity: 0.1,
    }),
  );
  plate.position.y = -1.85;
  plate.receiveShadow = true;
  world.add(plate);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8.3, 96),
    new THREE.MeshBasicMaterial({
      map: createFloorTexture(),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.48;
  world.add(floor);

  const centralRing = new THREE.Mesh(
    new THREE.TorusGeometry(4.65, 0.08, 20, 180),
    new THREE.MeshBasicMaterial({
      color: "#63f7ff",
      transparent: true,
      opacity: 0.42,
    }),
  );
  centralRing.rotation.x = Math.PI / 2;
  centralRing.position.y = -1.12;
  world.add(centralRing);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(6.8, 0.07, 20, 180),
    new THREE.MeshBasicMaterial({
      color: "#ff6ecb",
      transparent: true,
      opacity: 0.18,
    }),
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = -1.02;
  world.add(outerRing);

  const sculptureLeft = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.78, 0.18, 160, 24),
    new THREE.MeshPhysicalMaterial({
      color: "#0a1533",
      emissive: "#00e7ff",
      emissiveIntensity: 0.48,
      metalness: 0.95,
      roughness: 0.16,
      clearcoat: 1,
    }),
  );
  sculptureLeft.position.set(-5.5, 2.9, -3.6);
  world.add(sculptureLeft);

  const sculptureRight = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.78, 0.18, 160, 24),
    new THREE.MeshPhysicalMaterial({
      color: "#1d1022",
      emissive: "#ff66c4",
      emissiveIntensity: 0.48,
      metalness: 0.95,
      roughness: 0.18,
      clearcoat: 1,
    }),
  );
  sculptureRight.position.set(5.5, 2.7, -3.5);
  world.add(sculptureRight);

  const haloBack = new THREE.Mesh(
    new THREE.TorusGeometry(3.85, 0.1, 24, 180),
    new THREE.MeshBasicMaterial({
      color: "#ffd95e",
      transparent: true,
      opacity: 0.3,
    }),
  );
  haloBack.position.set(0, 2.4, -5.4);
  world.add(haloBack);

  const starField = createStarField(420);
  scene.add(starField.points);

  return {
    frontFill,
    leftLight,
    rightLight,
    backLight,
    centralRing,
    outerRing,
    sculptureLeft,
    sculptureRight,
    haloBack,
    starField,
  };
}

function createDie(x, palette, idleOffset) {
  const group = new THREE.Group();
  group.position.set(x, 0.95, 0);
  world.add(group);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 2.15, 0.42, 52),
    new THREE.MeshPhysicalMaterial({
      color: "#0b0f1c",
      emissive: palette.secondary,
      emissiveIntensity: 0.1,
      metalness: 0.92,
      roughness: 0.24,
      clearcoat: 1,
      clearcoatRoughness: 0.18,
    }),
  );
  pedestal.position.y = -1.1;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  const energyRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.85, 0.09, 18, 96),
    new THREE.MeshBasicMaterial({
      color: palette.edge,
      transparent: true,
      opacity: 0.48,
    }),
  );
  energyRing.position.y = -0.9;
  energyRing.rotation.x = Math.PI / 2;
  group.add(energyRing);

  const pedestalGlow = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 48),
    new THREE.MeshBasicMaterial({
      color: palette.primary,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  pedestalGlow.position.y = -0.88;
  pedestalGlow.rotation.x = -Math.PI / 2;
  group.add(pedestalGlow);

  const materials = Array.from({ length: 6 }, () =>
    new THREE.MeshStandardMaterial({
      color: "#f8fbff",
      emissive: palette.primary,
      emissiveIntensity: 0.2,
      metalness: 0.28,
      roughness: 0.5,
    }),
  );

  const cube = new THREE.Mesh(
    new RoundedBoxGeometry(2, 2, 2, 7, 0.22),
    materials,
  );
  cube.castShadow = true;
  cube.receiveShadow = true;
  cube.position.y = 0.42;
  group.add(cube);

  const cubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({
      color: palette.edge,
      transparent: true,
      opacity: 0.82,
    }),
  );
  cube.add(cubeEdges);

  const aura = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.52, 1),
    new THREE.MeshBasicMaterial({
      color: palette.primary,
      transparent: true,
      opacity: 0.09,
      wireframe: true,
    }),
  );
  aura.position.y = 0.42;
  group.add(aura);

  // Neon halo shell — slightly larger, BackSide for inner glow
  const glowShell = new THREE.Mesh(
    new RoundedBoxGeometry(2.22, 2.22, 2.22, 3, 0.28),
    new THREE.MeshBasicMaterial({
      color: palette.primary,
      transparent: true,
      opacity: 0.062,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  glowShell.position.y = 0.42;
  group.add(glowShell);

  return {
    group,
    cube,
    pedestal,
    energyRing,
    aura,
    glowShell,
    materials,
    textures: [],
    faceLetters: [],
    body: null,
    palette,
    idleOffset,
    initX: x,
  };
}

function createFloorTexture() {
  const size = 1024;
  const canvasTexture = document.createElement("canvas");
  canvasTexture.width = size;
  canvasTexture.height = size;
  const context = canvasTexture.getContext("2d");

  const background = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.5,
  );
  background.addColorStop(0, "rgba(255, 255, 255, 0.26)");
  background.addColorStop(0.16, "rgba(0, 236, 255, 0.28)");
  background.addColorStop(0.45, "rgba(255, 95, 175, 0.14)");
  background.addColorStop(1, "rgba(4, 9, 20, 0)");
  context.fillStyle = background;
  context.fillRect(0, 0, size, size);

  context.lineWidth = 2;
  for (let index = 1; index <= 7; index += 1) {
    context.beginPath();
    context.strokeStyle = `rgba(118, 246, 255, ${0.12 + index * 0.04})`;
    context.arc(size / 2, size / 2, index * 68, 0, TAU);
    context.stroke();
  }

  context.strokeStyle = "rgba(255, 212, 92, 0.32)";
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * TAU;
    context.beginPath();
    context.moveTo(size / 2, size / 2);
    context.lineTo(
      size / 2 + Math.cos(angle) * size * 0.48,
      size / 2 + Math.sin(angle) * size * 0.48,
    );
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createStarField(count) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const stride = index * 3;
    positions[stride] = THREE.MathUtils.randFloatSpread(22);
    positions[stride + 1] = THREE.MathUtils.randFloat(-1.5, 8.5);
    positions[stride + 2] = THREE.MathUtils.randFloatSpread(18) - 5.5;

    color.setHSL(0.48 + Math.random() * 0.18, 0.95, 0.68);
    colors[stride] = color.r;
    colors[stride + 1] = color.g;
    colors[stride + 2] = color.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.085,
      transparent: true,
      opacity: 0.95,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );

  return { points };
}

function createBurst() {
  const count = 560;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, () => new THREE.Vector3());
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const stride = index * 3;
    color.setHSL((index / count) * 1.0, 0.98, 0.68);
    colors[stride] = color.r;
    colors[stride + 1] = color.g;
    colors[stride + 2] = color.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.14,
      transparent: true,
      opacity: 0,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  scene.add(points);

  return {
    points,
    velocities,
    positions,
    life: 0,
    active: false,
    trigger(origin) {
      this.active = true;
      this.life = 1;
      for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const direction = new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(1.6),
          Math.random() * 2.8,
          THREE.MathUtils.randFloatSpread(1.6),
        ).normalize();

        const speed = THREE.MathUtils.randFloat(3.8, 10.5);
        this.velocities[index].copy(direction.multiplyScalar(speed));
        this.positions[stride] = origin.x;
        this.positions[stride + 1] = origin.y;
        this.positions[stride + 2] = origin.z;
      }

      this.points.material.opacity = 0.95;
      this.points.geometry.attributes.position.needsUpdate = true;
    },
    update(delta) {
      if (!this.active) {
        return;
      }

      this.life -= delta * 0.44;
      if (this.life <= 0) {
        this.active = false;
        this.points.material.opacity = 0;
        return;
      }

      for (let index = 0; index < count; index += 1) {
        const stride = index * 3;
        const velocity = this.velocities[index];
        this.positions[stride] += velocity.x * delta;
        this.positions[stride + 1] += velocity.y * delta;
        this.positions[stride + 2] += velocity.z * delta;
        velocity.y -= delta * 2.2;
        velocity.multiplyScalar(0.986);
      }

      this.points.material.opacity = this.life;
      this.points.geometry.attributes.position.needsUpdate = true;
    },
  };
}

function createLetterTexture(letter, palette, isFaceFront) {
  const size = 1024;
  const canvasTexture = document.createElement("canvas");
  canvasTexture.width = size;
  canvasTexture.height = size;
  const context = canvasTexture.getContext("2d");

  const base = context.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, "#06111f");
  base.addColorStop(0.4, palette.dark);
  base.addColorStop(1, "#12091d");
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  const innerGlow = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.46,
  );
  innerGlow.addColorStop(0, hexToRgba("#ffffff", isFaceFront ? 0.12 : 0.06));
  innerGlow.addColorStop(0.34, hexToRgba(palette.primary, isFaceFront ? 0.14 : 0.08));
  innerGlow.addColorStop(0.64, hexToRgba(palette.secondary, isFaceFront ? 0.08 : 0.04));
  innerGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = innerGlow;
  context.fillRect(0, 0, size, size);

  context.fillStyle = "rgba(4, 11, 24, 0.44)";
  context.fillRect(156, 156, size - 312, size - 312);

  const vignette = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.12,
    size / 2,
    size / 2,
    size * 0.62,
  );
  vignette.addColorStop(0, "rgba(255, 255, 255, 0)");
  vignette.addColorStop(0.72, "rgba(0, 0, 0, 0.08)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.44)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, size, size);

  context.strokeStyle = hexToRgba(palette.edge, 0.42);
  context.lineWidth = 6;
  for (let index = 0; index < 7; index += 1) {
    const inset = 74 + index * 32;
    context.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
  }

  context.strokeStyle = hexToRgba("#ffffff", 0.16);
  for (let index = 0; index < 9; index += 1) {
    const y = 104 + index * 96;
    context.beginPath();
    context.moveTo(96, y);
    context.lineTo(size - 96, y);
    context.stroke();
  }

  context.font = "900 520px Orbitron, Noto Sans SC, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 28;
  context.strokeStyle = "rgba(2, 7, 16, 0.88)";
  context.strokeText(letter, size / 2, size / 2 + 18);

  context.shadowColor = palette.primary;
  context.shadowBlur = isFaceFront ? 22 : 10;

  const typeGradient = context.createLinearGradient(250, 200, 780, 820);
  typeGradient.addColorStop(0, "#ffffff");
  typeGradient.addColorStop(0.56, "#f4fbff");
  typeGradient.addColorStop(1, isFaceFront ? palette.primary : "#dcecff");
  context.fillStyle = typeGradient;
  context.fillText(letter, size / 2, size / 2 + 18);

  context.shadowBlur = 0;
  context.font = "700 74px Orbitron, Noto Sans SC, sans-serif";
  context.fillStyle = hexToRgba("#ffffff", 0.52);
  context.fillText("NEON FATE", size / 2, 180);

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function applyFaces(die, letters) {
  die.faceLetters = Array.from(letters);
  die.textures.forEach((texture) => texture.dispose());
  die.textures = letters.map((letter, index) => {
    const texture = createLetterTexture(letter, die.palette, index === TOP_FACE_INDEX);
    const material = die.materials[index];
    material.map = texture;
    material.emissiveIntensity = index === TOP_FACE_INDEX ? 0.48 : 0.1;
    material.needsUpdate = true;
    return texture;
  });
}

function randomFaceSet(targetLetter) {
  const letters = Array.from({ length: 6 }, () => randomLetterExcluding(["K", "J"]));
  letters[TOP_FACE_INDEX] = targetLetter; // face[2] = +Y = top face after physics settle

  const sideIndices = [0, 1, 3, 4, 5]; // all except TOP_FACE_INDEX
  if (targetLetter === "K") {
    letters[pickRandom(sideIndices)] = "J";
  } else if (targetLetter === "J") {
    letters[pickRandom(sideIndices)] = "K";
  } else {
    const shuffled = shuffle(sideIndices);
    letters[shuffled[0]] = "K";
    letters[shuffled[1]] = "J";
  }

  return letters;
}

function randomLetter() {
  const index = Math.floor(Math.random() * ALPHABET.length);
  return ALPHABET[index];
}

function randomLetterExcluding(excludedLetters) {
  let letter = randomLetter();
  while (excludedLetters.includes(letter)) {
    letter = randomLetter();
  }
  return letter;
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(items) {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function chooseOutcome() {
  const resonanceChance =
    missStreak >= 6 ? 0.34 : missStreak >= 3 ? 0.18 : 0.09;

  if (Math.random() < resonanceChance) {
    return ["K", "J"];
  }

  return [randomLetter(), randomLetter()];
}

function startRoll() {
  if (rollState) {
    return;
  }

  const outcome = chooseOutcome();
  const isJackpot = outcome[0] === "K" && outcome[1] === "J";

  // SNAP world back to neutral so cannon scene-space = visual space
  viewRotation.yaw = 0;
  viewRotation.pitch = -0.06;
  viewRotation.velocityYaw = 0;
  viewRotation.velocityPitch = 0;
  world.rotation.set(0, 0, 0);

  rollState = {
    outcome,
    isJackpot,
    startElapsed: clock.elapsedTime,
    settled: [false, false],
    settleTimer: [0, 0],
    correcting: [false, false],
    correctStart: [0, 0],
    correctFrom: [new THREE.Quaternion(), new THREE.Quaternion()],
    correctTo: [new THREE.Quaternion(), new THREE.Quaternion()],
    done: false,
  };

  // Spawn a cannon-es rigid body for each die
  dice.forEach((die, index) => {
    if (die.body) {
      physWorld.removeBody(die.body);
      die.body = null;
    }

    const body = new CANNON.Body({
      mass: 1,
      material: physDieMat,
      linearDamping: 0.14,
      angularDamping: 0.08,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)));
    body.allowSleep = true;

    // Launch from just above camera into the scene — contained range
    body.position.set(
      die.initX + THREE.MathUtils.randFloatSpread(1.2),
      5.5 + Math.random() * 2.0,
      THREE.MathUtils.randFloatSpread(1.4),
    );

    // Moderate tumble angular velocity
    body.angularVelocity.set(
      THREE.MathUtils.randFloat(-13, 13),
      THREE.MathUtils.randFloat(-9, 9),
      THREE.MathUtils.randFloat(-13, 13),
    );

    // Downward with mild lateral drift
    body.velocity.set(
      THREE.MathUtils.randFloat(-1.4, 1.4),
      -4.5 - Math.random() * 2.5,
      THREE.MathUtils.randFloat(-0.8, 0.8),
    );

    // Random initial rotation so die doesn't start face-up
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU),
    );
    body.quaternion.set(q.x, q.y, q.z, q.w);

    physWorld.addBody(body);
    die.body = body;

    // Reset group/cube transforms
    die.group.position.set(die.initX, 5.5, 0);
    die.group.rotation.set(0, 0, 0);
    die.cube.position.set(0, 0.42, 0);
    die.cube.quaternion.copy(q);
  });

  outcome.forEach((letter, index) => {
    applyFaces(dice[index], randomFaceSet(letter));
  });

  setResult("?", "?");
  setStatus(isJackpot ? "KJ 共振正在建立..." : "量子骰子翻滚中...");
  rollButton.disabled = true;
  app.classList.add("is-rolling");
}

function finishRoll() {
  // After correction slerp, face[TOP_FACE_INDEX] is always on top
  const left = dice[0].faceLetters[TOP_FACE_INDEX] ?? '?';
  const right = dice[1].faceLetters[TOP_FACE_INDEX] ?? '?';
  const isJackpot = left === 'K' && right === 'J';

  setResult(left, right);
  setStatus(
    isJackpot
      ? "欢迎仪式已点亮，MeowKJ 上线。"
      : `结果是 ${left}${right}，再投一次冲击 KJ。`,
  );

  rollButton.disabled = false;
  app.classList.remove("is-rolling");

  // Clean up cannon bodies
  dice.forEach((die) => {
    if (die.body) {
      physWorld.removeBody(die.body);
      die.body = null;
    }
    // Restore visual idle position
    die.group.position.set(die.initX, LAND_Y, 0);
    die.group.rotation.set(0, 0, 0);
  });

  rollState = null;

  if (isJackpot) {
    missStreak = 0;
    triggerJackpot();
  } else {
    missStreak += 1;
  }
}

function startCorrection(index, die) {
  const currentQ = die.cube.quaternion.clone();

  // Find which local axis is currently pointing closest to world +Y
  const worldUp = new THREE.Vector3(0, 1, 0);
  // Local +Y direction in world space
  const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(currentQ);

  // Rotation to align local +Y → world +Y (shortest arc)
  const alignQ = new THREE.Quaternion().setFromUnitVectors(localY, worldUp);
  // baseQ is a quaternion where local +Y = world +Y (but any Y-rotation around it)
  const baseQ = alignQ.clone().multiply(currentQ);

  // 4 possible discrete Y-axis orientations (0°, 90°, 180°, 270°)
  const candidates = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map(
    (a) => new THREE.Quaternion().setFromAxisAngle(worldUp, a).multiply(baseQ),
  );

  // Pick the candidate closest to where the die currently is (minimise slerp travel)
  let bestQ = candidates[0];
  let bestDot = -Infinity;
  candidates.forEach((q) => {
    const d = Math.abs(q.dot(currentQ));
    if (d > bestDot) { bestDot = d; bestQ = q; }
  });

  rollState.correcting[index] = true;
  rollState.correctStart[index] = clock.elapsedTime;
  rollState.correctFrom[index] = currentQ;
  rollState.correctTo[index] = bestQ;

  spawnShockwave(die, 1.0);
  cameraShake.power = Math.max(cameraShake.power, 0.22);
}

function triggerJackpot() {
  jackpotPulse = 1;
  burst.trigger(new THREE.Vector3(0, 1.9, 0.4));
  app.classList.add("is-jackpot");
  jackpotPanel.classList.add("active");
  screenFlash.classList.add("active");

  clearTimeout(jackpotTimeout);
  clearTimeout(flashTimeout);

  flashTimeout = window.setTimeout(() => {
    screenFlash.classList.remove("active");
  }, 420);

  jackpotTimeout = window.setTimeout(() => {
    app.classList.remove("is-jackpot");
    jackpotPanel.classList.remove("active");
  }, 4200);
}

function setResult(left, right) {
  leftLetter.textContent = left;
  rightLetter.textContent = right;
}

function setStatus(text) {
  statusText.textContent = text;
}

function beginViewportDrag(event) {
  if (event.button !== 0) {
    return;
  }

  viewRotation.dragging = true;
  viewRotation.lastX = event.clientX;
  viewRotation.lastY = event.clientY;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
}

function updateViewportDrag(event) {
  if (!viewRotation.dragging) {
    return;
  }

  const deltaX = event.clientX - viewRotation.lastX;
  const deltaY = event.clientY - viewRotation.lastY;

  viewRotation.lastX = event.clientX;
  viewRotation.lastY = event.clientY;
  viewRotation.yaw += deltaX * 0.0062;
  viewRotation.pitch = THREE.MathUtils.clamp(
    viewRotation.pitch + deltaY * 0.0032,
    -0.32,
    0.2,
  );
  viewRotation.velocityYaw = deltaX * 0.00095;
  viewRotation.velocityPitch = deltaY * 0.00052;
}

function endViewportDrag(event) {
  if (!viewRotation.dragging) {
    return;
  }

  viewRotation.dragging = false;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

function easeOutQuint(value) {
  return 1 - (1 - value) ** 5;
}

function easeOutCubic(value) {
  return 1 - (1 - value) ** 3;
}

function hexToRgba(hex, alpha) {
  const color = new THREE.Color(hex);
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
    color.b * 255,
  )}, ${alpha})`;
}

function spawnShockwave(die, intensity = 1) {
  // Main colour ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.4, 64),
    new THREE.MeshBasicMaterial({
      color: die.palette.primary,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(die.group.position.x, -0.72, 0);
  world.add(ring);
  shockwaves.push({ mesh: ring, life: 1, intensity });

  // Inner white flash ring
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(0.02, 0.22, 48),
    new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(die.group.position.x, -0.68, 0);
  world.add(inner);
  shockwaves.push({ mesh: inner, life: 1, intensity: intensity * 0.55 });

  // Secondary colour ring (contrasting colour)
  const secondary = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.28, 56),
    new THREE.MeshBasicMaterial({
      color: die.palette.secondary,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  secondary.rotation.x = -Math.PI / 2;
  secondary.position.set(die.group.position.x, -0.70, 0);
  world.add(secondary);
  shockwaves.push({ mesh: secondary, life: 1, intensity: intensity * 0.7 });
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  jackpotPulse = THREE.MathUtils.damp(jackpotPulse, 0, 2.2, delta);

  if (!viewRotation.dragging) {
    const inertia = Math.pow(0.9, delta * 60);
    viewRotation.yaw += viewRotation.velocityYaw;
    viewRotation.pitch = THREE.MathUtils.clamp(
      viewRotation.pitch + viewRotation.velocityPitch,
      -0.32,
      0.2,
    );
    viewRotation.velocityYaw *= inertia;
    viewRotation.velocityPitch *= inertia;
  }

  // Only update world rotation when not rolling (keeps physics alignment clean)
  if (!rollState) {
    world.rotation.y = THREE.MathUtils.damp(world.rotation.y, viewRotation.yaw, 6.4, delta);
    world.rotation.x = THREE.MathUtils.damp(
      world.rotation.x,
      viewRotation.pitch + jackpotPulse * 0.05,
      6.4,
      delta,
    );
  }

  if (rollState) {
    // Step cannon-es physics at fixed 60 Hz
    physWorld.step(1 / 60, delta, 3);

    dice.forEach((die, index) => {
      if (!die.body) return;
      const body = die.body;

      // Direct sync — world.rotation=0 during roll, so scene space = world-group space
      die.group.position.x = body.position.x;
      die.group.position.y = body.position.y - 0.42; // 0.42 = cube local Y offset inside group
      die.group.position.z = body.position.z;

      // Cube quaternion directly from cannon body
      die.cube.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );

      // Settle detection: body speed below threshold for 0.55 s
      if (!rollState.settled[index] && !rollState.correcting[index]) {
        const speed = body.velocity.length() + body.angularVelocity.length() * 0.15;
        if (speed < 0.5) {
          rollState.settleTimer[index] += delta;
          if (rollState.settleTimer[index] > 0.55) {
            rollState.settled[index] = true;
            startCorrection(index, die);
          }
        } else {
          rollState.settleTimer[index] = 0;
        }
      }

      // Hard timeout – force settle after 8 s
      if (!rollState.settled[index] && elapsed - rollState.startElapsed > 8) {
        rollState.settled[index] = true;
        startCorrection(index, die);
      }

      // Correction slerp – bring target face to the top
      if (rollState.correcting[index]) {
        const t = Math.min((elapsed - rollState.correctStart[index]) / 0.7, 1);
        die.cube.quaternion.slerpQuaternions(
          rollState.correctFrom[index],
          rollState.correctTo[index],
          easeOutCubic(t),
        );
        if (t >= 1) {
          rollState.correcting[index] = false;
          die.cube.quaternion.copy(rollState.correctTo[index]);
        }
      }

      // Visual effects during flight
      const aboveFloor = Math.max(0, die.group.position.y - LAND_Y + 0.6);
      die.energyRing.scale.setScalar(1 + Math.max(0, 1 - aboveFloor * 0.18) * 0.45);
      die.aura.material.opacity = 0.1 + Math.sin(elapsed * 18 + index * 2.5) * 0.07;
      die.aura.rotation.x += delta * (index === 0 ? 1.8 : -1.8);
      die.aura.rotation.y += delta * (index === 0 ? -2.2 : 2.0);
      if (die.glowShell) {
        die.glowShell.material.opacity = 0.09 + Math.sin(elapsed * 11 + index * Math.PI) * 0.06;
      }
    });

    // Both dice settled + correction done → show result
    if (
      !rollState.done
      && rollState.settled[0] && rollState.settled[1]
      && !rollState.correcting[0] && !rollState.correcting[1]
    ) {
      rollState.done = true;
      finishRoll();
    }
  } else {
    dice.forEach((die, index) => {
      const wave = elapsed * 0.95 + die.idleOffset;
      die.group.position.y = 0.95 + Math.sin(wave) * 0.12;
      die.group.rotation.x = Math.sin(wave * 1.15) * 0.08;
      die.group.rotation.y = Math.sin(wave * 0.7) * 0.2;
      die.energyRing.rotation.z += delta * (index === 0 ? 0.78 : -0.72);
      die.aura.rotation.x += delta * (index === 0 ? 0.22 : -0.22);
      die.aura.rotation.y += delta * (index === 0 ? -0.3 : 0.3);
    });
  }

  burst.update(delta);

  // Shockwave rings — expand + fade
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const sw = shockwaves[i];
    sw.life -= delta * 2.4;
    if (sw.life <= 0) {
      world.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      sw.mesh.material.dispose();
      shockwaves.splice(i, 1);
    } else {
      sw.mesh.scale.setScalar((1 - sw.life) * 5.5 * sw.intensity + 0.18);
      sw.mesh.material.opacity = sw.life * 0.92 * sw.intensity;
    }
  }

  // Camera shake on hard landing
  if (cameraShake.power > 0.002) {
    cameraShake.power *= 0.78;
    camera.position.x += (Math.random() - 0.5) * cameraShake.power * 0.9;
    camera.position.y += (Math.random() - 0.5) * cameraShake.power * 0.45;
  }

  environment.centralRing.rotation.z += delta * 0.18;
  environment.outerRing.rotation.z -= delta * 0.13;
  environment.sculptureLeft.rotation.x += delta * 0.28;
  environment.sculptureLeft.rotation.y -= delta * 0.42;
  environment.sculptureRight.rotation.x -= delta * 0.26;
  environment.sculptureRight.rotation.y += delta * 0.46;
  environment.haloBack.rotation.x = Math.sin(elapsed * 0.6) * 0.28;
  environment.haloBack.rotation.y += delta * 0.16;
  environment.starField.points.rotation.y += delta * 0.015;
  environment.starField.points.rotation.x = Math.sin(elapsed * 0.12) * 0.04;

  const cameraJackpotLift = jackpotPulse * 0.65;
  camera.position.x = Math.sin(elapsed * 0.16) * 0.14;
  camera.position.y = 2.15 + cameraJackpotLift;
  camera.position.z = 10.8 - jackpotPulse * 0.55;
  camera.lookAt(0, 0.7 + jackpotPulse * 0.25, 0);

  environment.frontFill.intensity = 0.92 + jackpotPulse * 0.32;
  environment.leftLight.intensity = 18 + jackpotPulse * 16;
  environment.rightLight.intensity = 16 + jackpotPulse * 14;
  environment.backLight.intensity = 8 + jackpotPulse * 8;

  bloomPass.strength = 0.92 + jackpotPulse * 1.5;

  composer.render();
}
