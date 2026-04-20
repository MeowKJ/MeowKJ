import "./styles.css";

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FRONT_FACE_INDEX = 4;
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
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#050816");
scene.fog = new THREE.Fog("#050816", 11, 28);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 2.2, 10.8);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.25, 0.85, 0.45);
bloomPass.threshold = 0.08;
bloomPass.strength = 1.35;
bloomPass.radius = 0.75;
composer.addPass(bloomPass);

const clock = new THREE.Clock();
const pointerTarget = new THREE.Vector2();
const pointer = new THREE.Vector2();

let rollState = null;
let missStreak = 0;
let jackpotTimeout = null;
let flashTimeout = null;
let jackpotPulse = 0;

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

window.addEventListener("pointermove", (event) => {
  pointerTarget.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointerTarget.y = (event.clientY / window.innerHeight) * 2 - 1;
});

window.addEventListener("resize", onResize);

setResult("?", "?");
setStatus("点击按钮，启动双骰霓虹引擎。");
dice.forEach((die) => applyFaces(die, randomFaceSet(randomLetter())));
onResize();
animate();

function buildEnvironment() {
  const ambient = new THREE.HemisphereLight("#78ecff", "#050816", 1.1);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight("#ffffff", 0.85);
  sun.position.set(0, 9, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  scene.add(sun);

  const leftLight = new THREE.PointLight("#00e6ff", 28, 16, 2);
  leftLight.position.set(-5.5, 2.6, 2.5);
  scene.add(leftLight);

  const rightLight = new THREE.PointLight("#ff5ab7", 24, 15, 2);
  rightLight.position.set(5.5, 2.8, 2.5);
  scene.add(rightLight);

  const backLight = new THREE.PointLight("#77ffcc", 12, 20, 2);
  backLight.position.set(0, 4.5, -6);
  scene.add(backLight);

  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(8.4, 9.2, 0.65, 72),
    new THREE.MeshPhysicalMaterial({
      color: "#060812",
      metalness: 0.88,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.22,
      emissive: "#081526",
      emissiveIntensity: 0.18,
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
      opacity: 0.95,
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
      opacity: 0.85,
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
      opacity: 0.45,
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
      emissiveIntensity: 1.15,
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
      emissiveIntensity: 1.15,
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
      opacity: 0.7,
    }),
  );
  haloBack.position.set(0, 2.4, -5.4);
  world.add(haloBack);

  const starField = createStarField(420);
  scene.add(starField.points);

  return {
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
      emissiveIntensity: 0.22,
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
      opacity: 0.85,
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
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  pedestalGlow.position.y = -0.88;
  pedestalGlow.rotation.x = -Math.PI / 2;
  group.add(pedestalGlow);

  const materials = Array.from({ length: 6 }, () =>
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      emissive: palette.primary,
      emissiveIntensity: 0.7,
      metalness: 0.4,
      roughness: 0.34,
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
      opacity: 0.92,
    }),
  );
  cube.add(cubeEdges);

  const aura = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.42, 1),
    new THREE.MeshBasicMaterial({
      color: palette.primary,
      transparent: true,
      opacity: 0.12,
      wireframe: true,
    }),
  );
  aura.position.y = 0.42;
  group.add(aura);

  return {
    group,
    cube,
    pedestal,
    energyRing,
    aura,
    materials,
    textures: [],
    palette,
    idleOffset,
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
  const count = 320;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const velocities = Array.from({ length: count }, () => new THREE.Vector3());
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const stride = index * 3;
    color.setHSL((index / count) * 0.25 + 0.02, 0.95, 0.65);
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

        const speed = THREE.MathUtils.randFloat(2.4, 6.6);
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
  base.addColorStop(0, palette.dark);
  base.addColorStop(0.45, "#091429");
  base.addColorStop(1, "#14061c");
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
  innerGlow.addColorStop(0, hexToRgba(palette.primary, isFaceFront ? 0.62 : 0.38));
  innerGlow.addColorStop(0.6, hexToRgba(palette.secondary, isFaceFront ? 0.26 : 0.12));
  innerGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = innerGlow;
  context.fillRect(0, 0, size, size);

  context.strokeStyle = hexToRgba(palette.edge, 0.42);
  context.lineWidth = 8;
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

  context.font = "900 560px Orbitron, Noto Sans SC, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = palette.primary;
  context.shadowBlur = isFaceFront ? 78 : 38;

  const typeGradient = context.createLinearGradient(250, 200, 780, 820);
  typeGradient.addColorStop(0, "#ffffff");
  typeGradient.addColorStop(0.4, palette.primary);
  typeGradient.addColorStop(1, palette.secondary);
  context.fillStyle = typeGradient;
  context.fillText(letter, size / 2, size / 2 + 8);

  context.shadowBlur = 0;
  context.font = "700 84px Orbitron, Noto Sans SC, sans-serif";
  context.fillStyle = hexToRgba("#ffffff", 0.58);
  context.fillText("NEON FATE", size / 2, 180);

  const texture = new THREE.CanvasTexture(canvasTexture);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function applyFaces(die, letters) {
  die.textures.forEach((texture) => texture.dispose());
  die.textures = letters.map((letter, index) => {
    const texture = createLetterTexture(letter, die.palette, index === FRONT_FACE_INDEX);
    const material = die.materials[index];
    material.map = texture;
    material.emissiveIntensity = index === FRONT_FACE_INDEX ? 1.25 : 0.72;
    material.needsUpdate = true;
    return texture;
  });
}

function randomFaceSet(targetLetter) {
  const letters = Array.from({ length: 6 }, () => randomLetter());
  letters[FRONT_FACE_INDEX] = targetLetter;
  return letters;
}

function randomLetter() {
  const index = Math.floor(Math.random() * ALPHABET.length);
  return ALPHABET[index];
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

  rollState = {
    start: performance.now(),
    duration: 2150,
    outcome,
    isJackpot,
    dice: dice.map((die) => ({
      die,
      startX: die.cube.rotation.x,
      startY: die.cube.rotation.y,
      startZ: die.cube.rotation.z,
      endX:
        die.cube.rotation.x +
        THREE.MathUtils.randFloat(7.8, 10.6) * TAU * (Math.random() > 0.5 ? 1 : -1),
      endY:
        die.cube.rotation.y +
        THREE.MathUtils.randFloat(8.8, 12.4) * TAU * (Math.random() > 0.5 ? 1 : -1),
      endZ:
        die.cube.rotation.z +
        THREE.MathUtils.randFloat(7.1, 9.2) * TAU * (Math.random() > 0.5 ? 1 : -1),
      bounce: THREE.MathUtils.randFloat(0.48, 0.86),
    })),
  };

  outcome.forEach((letter, index) => {
    applyFaces(dice[index], randomFaceSet(letter));
  });

  setResult("?", "?");
  setStatus(isJackpot ? "KJ 共振正在建立..." : "量子骰子翻滚中...");
  rollButton.disabled = true;
  app.classList.add("is-rolling");
}

function finishRoll() {
  const [left, right] = rollState.outcome;
  const isJackpot = rollState.isJackpot;

  setResult(left, right);
  setStatus(
    isJackpot
      ? "欢迎仪式已点亮，MeowKJ 上线。"
      : `结果是 ${left}${right}，再投一次冲击 KJ。`,
  );

  rollButton.disabled = false;
  app.classList.remove("is-rolling");
  rollState = null;

  if (isJackpot) {
    missStreak = 0;
    triggerJackpot();
  } else {
    missStreak += 1;
  }
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

function easeOutQuint(value) {
  return 1 - (1 - value) ** 5;
}

function hexToRgba(hex, alpha) {
  const color = new THREE.Color(hex);
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
    color.b * 255,
  )}, ${alpha})`;
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

  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  pointer.lerp(pointerTarget, 0.07);

  jackpotPulse = THREE.MathUtils.damp(jackpotPulse, 0, 2.2, delta);

  if (rollState) {
    const progress = Math.min(
      (performance.now() - rollState.start) / rollState.duration,
      1,
    );
    const eased = easeOutQuint(progress);

    rollState.dice.forEach((entry, index) => {
      const die = entry.die;
      die.cube.rotation.set(
        THREE.MathUtils.lerp(entry.startX, entry.endX, eased),
        THREE.MathUtils.lerp(entry.startY, entry.endY, eased),
        THREE.MathUtils.lerp(entry.startZ, entry.endZ, eased),
      );
      die.group.position.y =
        0.95 + Math.sin(progress * Math.PI) * entry.bounce;
      die.energyRing.scale.setScalar(1 + Math.sin(progress * Math.PI) * 0.22);
      die.aura.rotation.x += delta * (index === 0 ? 1.2 : -1.2);
      die.aura.rotation.y += delta * (index === 0 ? -1.7 : 1.5);
    });

    if (progress >= 1) {
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
  camera.position.x = pointer.x * 0.7 + Math.sin(elapsed * 0.16) * 0.18;
  camera.position.y = 2.2 - pointer.y * 0.42 + cameraJackpotLift;
  camera.position.z = 10.8 - jackpotPulse * 1.2;
  camera.lookAt(0, 0.7 + jackpotPulse * 0.25, 0);

  environment.leftLight.intensity = 28 + jackpotPulse * 22;
  environment.rightLight.intensity = 24 + jackpotPulse * 22;
  environment.backLight.intensity = 12 + jackpotPulse * 12;

  bloomPass.strength = 1.35 + jackpotPulse * 1.3;

  composer.render();
}
