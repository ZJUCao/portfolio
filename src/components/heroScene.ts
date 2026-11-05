// 首页的 3D 场景，仿照 SceneGraph-AR 的画面：棋盘格标定板上立着一座场景图城堡，
// 板上标出 OpenCV 找到的 9×6 个内角点（每行一种颜色连起来，和 drawChessboardCorners 画的一样）和坐标轴。
// 镜头绕着慢慢转，鼠标移动时视角跟着偏一点，像头部追踪。支持 WebXR 的设备上可以把它放进 AR / VR 里看。
// 摄像头 AR 的画面 createCameraScene 也在这里，和首页共用同一套城堡和标注。
// 只由 HeroViewport 和 CameraAR 按需加载，three.js 不进其他页面的代码。

import * as THREE from "three";
import { BOARD } from "@/ar/board";

export type XRMode = "immersive-ar" | "immersive-vr";
// 每秒报几次：帧率，以及相机相对标定板中心的位置（米）和朝向（度）
export type Stats = { fps: number; x: number; y: number; z: number; yaw: number };

// 10×7 个格子、9×6 个内角点，和摄像头 AR 识别的标定板是同一份尺寸（src/ar/board.ts）；
// 一格打印出来是 25 毫米，用来把位置换算成米
const COLS = BOARD.squaresX;
const ROWS = BOARD.squaresY;
const SQUARE = BOARD.squareSize;
const METERS_PER_UNIT = BOARD.squareMeters / BOARD.squareSize;

const CAMERA = { radius: 4.7, height: 3, target: new THREE.Vector3(0, 0.3, 0) };

export function createHeroScene(
  container: HTMLElement,
  { reducedMotion, onStats }: { reducedMotion: boolean; onStats: (stats: Stats) => void },
) {
  // 不支持 WebGL 时这里会抛错，由调用方接住，页面保留静态的底图
  const renderer = createRenderer(container);
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
  // 标定板、城堡等都放在 world 里，进 XR 时整体缩小、挪到用户面前
  const world = new THREE.Group();
  scene.add(world);
  addLights(scene);

  world.add(board(renderer), corners(), axes(), blobShadow(), castle());
  const ring = scanRing();
  world.add(ring);
  const dust = particles();
  world.add(dust);

  // VR 里四周一片黑，铺一层地面网格当参照，平时不显示
  const floor = new THREE.GridHelper(20, 40, "#5fe3ff", "#1d2a44");
  floor.visible = false;
  scene.add(floor);

  // 鼠标在画面上的位置（-1 到 1），镜头朝它偏过去
  const pointer = { x: 0, y: 0 };
  const look = { x: 0, y: 0 };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const box = container.getBoundingClientRect();
    pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    pointer.y = ((event.clientY - box.top) / box.height) * 2 - 1;
  };
  const onPointerLeave = () => {
    pointer.x = 0;
    pointer.y = 0;
  };
  if (!reducedMotion) {
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
  }

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 竖着的窄画面（手机）把视野放宽，整块标定板都能看见
    camera.fov = camera.aspect < 1 ? 48 : 35;
    camera.updateProjectionMatrix();
    if (reducedMotion && !renderer.xr.isPresenting) render(0, 0);
  };

  let yaw = 0.6;
  let frames = 0;
  let statsClock = 0;
  const timer = new THREE.Timer();

  function render(dt: number, time: number) {
    if (!reducedMotion) {
      animateRing(ring, time);
      drift(dust, dt);
    }
    // 在 XR 里镜头跟着头显走，这里不去动它
    if (!renderer.xr.isPresenting) {
      if (!reducedMotion) {
        yaw += dt * 0.08;
        const ease = 1 - Math.exp(-dt * 3);
        look.x += (pointer.x - look.x) * ease;
        look.y += (pointer.y - look.y) * ease;
      }
      const angle = yaw + look.x * 0.45;
      camera.position.set(
        Math.sin(angle) * CAMERA.radius,
        CAMERA.height - look.y * 0.6,
        Math.cos(angle) * CAMERA.radius,
      );
      camera.lookAt(CAMERA.target);
    }
    renderer.render(scene, camera);
  }

  const report = (fps: number) => {
    const p = camera.position;
    onStats({
      fps,
      x: p.x * METERS_PER_UNIT,
      y: p.y * METERS_PER_UNIT,
      z: p.z * METERS_PER_UNIT,
      yaw: (THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z)) + 360) % 360,
    });
  };

  function frame() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.1);
    render(dt, timer.getElapsed());
    frames++;
    statsClock += dt;
    if (statsClock >= 0.25 && !renderer.xr.isPresenting) {
      report(Math.round(frames / statsClock));
      frames = 0;
      statsClock = 0;
    }
  }

  // 画面滚出视口、或者摄像头 AR 盖在上面（paused）时停下来，不白耗电；「减少动态效果」时只画静止的一帧。
  // 正在 XR 里时照常画
  let visible = true;
  let paused = false;
  const updateLoop = () => {
    const animate = renderer.xr.isPresenting || (visible && !paused && !reducedMotion);
    renderer.setAnimationLoop(animate ? frame : null);
  };
  const setPaused = (value: boolean) => {
    paused = value;
    updateLoop();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateLoop();
  });
  observer.observe(container);
  const resizer = new ResizeObserver(resize);
  resizer.observe(container);
  resize();
  if (reducedMotion) {
    render(0, 0);
    report(0);
  }
  updateLoop();

  // 进入 AR / VR：模型缩到一个桌面摆件大小，放在用户面前；退出后恢复原样
  async function enterXR(mode: XRMode) {
    const session = await navigator.xr?.requestSession(mode, { optionalFeatures: ["local-floor"] });
    if (!session) return;
    renderer.xr.setReferenceSpaceType("local-floor");
    await renderer.xr.setSession(session);
    world.scale.setScalar(0.16);
    world.position.set(0, mode === "immersive-ar" ? 0.8 : 1.0, -0.8);
    floor.visible = mode === "immersive-vr";
    updateLoop();
    session.addEventListener("end", () => {
      world.scale.setScalar(1);
      world.position.set(0, 0, 0);
      floor.visible = false;
      updateLoop();
      resize();
    });
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    resizer.disconnect();
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerleave", onPointerLeave);
    renderer.xr.getSession()?.end();
    disposeAll(scene, renderer);
  }

  return { enterXR, setPaused, dispose };
}

// 摄像头 AR 的画面：一块透明画布叠在摄像头画面上，城堡、角点连线、坐标轴、影子和扫描环都和首页一样，
// 但没有虚拟的标定板、光点、地面网格，不跟鼠标，也没有 WebXR。相机直接用 pose.ts 从真实标定板算出的
// 视图矩阵和投影矩阵（列主序），找不到标定板时（view 为 null）整个场景隐藏。挂载期间一直在画
export function createCameraScene(container: HTMLElement, { reducedMotion }: { reducedMotion: boolean }) {
  const renderer = createRenderer(container);
  const scene = new THREE.Scene();
  addLights(scene);
  const world = new THREE.Group();
  world.visible = false;
  world.add(corners(), axes(), blobShadow(), castle());
  const ring = scanRing();
  world.add(ring);
  scene.add(world);

  // 位置和投影都由 setPose 直接给，three.js 不再按 position 和 fov 去算
  const camera = new THREE.PerspectiveCamera();
  camera.matrixAutoUpdate = false;

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w && h) renderer.setSize(w, h, false);
  };
  const resizer = new ResizeObserver(resize);
  resizer.observe(container);
  resize();

  const timer = new THREE.Timer();
  renderer.setAnimationLoop(() => {
    timer.update();
    if (!reducedMotion) animateRing(ring, timer.getElapsed());
    renderer.render(scene, camera);
  });

  function setPose(view: ArrayLike<number> | null, projection: ArrayLike<number> | null) {
    if (!view || !projection) {
      world.visible = false;
      return;
    }
    // view 把场景坐标换到相机坐标，相机自己在场景里的变换是它的逆
    camera.matrix.fromArray(Array.from(view)).invert();
    camera.matrixWorldNeedsUpdate = true;
    camera.projectionMatrix.fromArray(Array.from(projection));
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    world.visible = true;
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    resizer.disconnect();
    disposeAll(scene, renderer);
  }

  return { setPose, dispose };
}

// 透明背景的画布，铺满容器。像素比最多 2，手机上不白画太多像素
function createRenderer(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);
  return renderer;
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight("#bcd7ff", "#1a1030", 1.4));
  const sun = new THREE.DirectionalLight("#ffffff", 2.4);
  sun.position.set(3, 5, 2);
  scene.add(sun);
  // 背后一道青色的光，给城堡描一圈亮边
  const rim = new THREE.DirectionalLight("#5fe3ff", 1.6);
  rim.position.set(-3, 2, -4);
  scene.add(rim);
}

// 释放显存里的几何体、材质和贴图，再移走画布
function disposeAll(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
      object.geometry.dispose();
      for (const material of [object.material].flat()) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
  renderer.dispose();
  renderer.domElement.remove();
}

// 棋盘格标定板，四周留一圈白边，和打印出来的一样
function board(renderer: THREE.WebGLRenderer) {
  const px = 64;
  const canvas = document.createElement("canvas");
  canvas.width = (COLS + 1) * px;
  canvas.height = (ROWS + 1) * px;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#b3bfd0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0a0f18";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 0) ctx.fillRect((c + 0.5) * px, (r + 0.5) * px, px, px);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry((COLS + 1) * SQUARE, (ROWS + 1) * SQUARE),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.88, toneMapped: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// 第 i 列、第 j 行内角点在板上的位置
const cornerAt = (i: number, j: number, y = 0.004) =>
  new THREE.Vector3((i + 1 - COLS / 2) * SQUARE, y, (j + 1 - ROWS / 2) * SQUARE);

// 角点和坐标轴是 OpenCV 叠在画面最上层的标注，这里也不做深度测试，城堡挡不住它们
const overlay = { depthTest: false, transparent: true, toneMapped: false };
const OVERLAY_ORDER = 10;

// 9×6 个内角点：每行一种颜色，用线按顺序连起来，行尾接到下一行开头
function corners() {
  const group = new THREE.Group();
  const points: THREE.Vector3[] = [];
  const colors: number[] = [];
  for (let j = 0; j < ROWS - 1; j++) {
    const color = new THREE.Color().setHSL(j / (ROWS - 1), 0.9, 0.62);
    for (let i = 0; i < COLS - 1; i++) {
      points.push(cornerAt(i, j));
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ ...overlay, vertexColors: true, opacity: 0.9 })));
  group.add(
    new THREE.Points(
      geometry.clone(),
      // 圆圈大小随透视缩放，手机上的小画面里不会显得太大；圈小一点、淡一点，不抢城堡的风头
      new THREE.PointsMaterial({ ...overlay, vertexColors: true, map: ringSprite(), size: 0.1, opacity: 0.7 }),
    ),
  );
  group.traverse((object) => (object.renderOrder = OVERLAY_ORDER));
  return group;
}

// 角点上画的小圆圈，和 OpenCV 的一样是空心的；颜色由各点的顶点色决定
function ringSprite() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(16, 16, 12, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(canvas);
}

// 坐标轴画在第一个内角点上：X 红、Y 绿、Z 蓝，Z 轴垂直于板面朝上
function axes() {
  const origin = cornerAt(0, 0, 0.006);
  const length = SQUARE * 3;
  const group = new THREE.Group();
  const directions: [THREE.Vector3, string][] = [
    [new THREE.Vector3(1, 0, 0), "#ff5d6c"],
    [new THREE.Vector3(0, 0, 1), "#5dff9a"],
    [new THREE.Vector3(0, 1, 0), "#5d9dff"],
  ];
  for (const [direction, color] of directions) {
    const arrow = new THREE.ArrowHelper(direction, origin, length, color, length * 0.22, length * 0.12);
    for (const part of [arrow.line, arrow.cone]) {
      Object.assign(part.material, overlay);
      part.renderOrder = OVERLAY_ORDER;
    }
    group.add(arrow);
  }
  return group;
}

// 城堡底下一团柔和的影子，让它看起来是立在板上的
function blobShadow() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,0.75)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.25),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

// 用基本几何体搭的城堡：底座、主楼、四座角楼和中间的尖塔，每块都描一圈半透明的边
function castle() {
  const group = new THREE.Group();
  const edges = new THREE.LineBasicMaterial({ color: "#d6ecff", transparent: true, opacity: 0.35 });
  const add = (geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }));
    mesh.position.set(x, y, z);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), edges));
    group.add(mesh);
  };
  add(new THREE.BoxGeometry(1.3, 0.28, 0.9), "#5b5bd6", 0, 0.14, 0);
  add(new THREE.BoxGeometry(0.56, 0.62, 0.5), "#3d7bf2", 0, 0.59, 0);
  for (const [x, z] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) {
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.78, 20), "#e8609f", x, 0.39, z);
    add(new THREE.ConeGeometry(0.18, 0.34, 20), "#ffb347", x, 0.95, z);
  }
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 16), "#e8609f", 0, 1.11, 0);
  add(new THREE.ConeGeometry(0.15, 0.4, 16), "#ffb347", 0, 1.52, 0);
  // 缩小一些，露出四周的角点连线
  group.scale.setScalar(0.72);
  return group;
}

// 从板中心向外扩散、逐渐变淡的青色圆环，表示正在追踪
function scanRing() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.97, 1, 96),
    new THREE.MeshBasicMaterial({
      color: "#5fe3ff",
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.008;
  return mesh;
}

function animateRing(ring: THREE.Mesh, time: number) {
  const t = (time % 3.2) / 3.2;
  ring.scale.setScalar(0.2 + t * 1.9);
  (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t) ** 2;
}

// 空中缓缓上浮的光点，给画面一点纵深。分布在板子上方 6×2.6×6 的空间里
const DUST = { count: 160, width: 6, height: 2.6 };

function particles() {
  const positions = new Float32Array(DUST.count * 3);
  for (let i = 0; i < DUST.count; i++) {
    positions.set(
      [(Math.random() - 0.5) * DUST.width, Math.random() * DUST.height, (Math.random() - 0.5) * DUST.width],
      i * 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: "#9fdcff",
      size: 0.022,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
}

function drift(points: THREE.Points, dt: number) {
  const position = points.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < DUST.count; i++) {
    const y = position.getY(i) + dt * 0.08;
    position.setY(i, y > DUST.height ? 0 : y);
  }
  position.needsUpdate = true;
}
