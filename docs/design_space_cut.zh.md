# 设计：空间切口转场

状态：**已确认（2026-11-06）**，D1–D9 和 OQ-1–OQ-5 全部采用建议；**P0 验证已完成**（§12），2026-11-06 采用 P0-1、P0-2；P1 引擎已合入（PR #5）；P2 已合入（PR #6）；P3 已合入（PR #7）；P4 已合入（PR #8）；P5 已合入（PR #10），见 §13 · 依据：[需求文档](requirements_space_cut.zh.md)（已确认）· 分期：P0–P5（§9）

## 1. 目标

把需求文档里的转场做进作品集。需求文档 §4 列出了要做的入口：摄像头 AR、中英切换、404 页、首页 3D 取景框里的彩蛋、项目卡片到详情页，另外还有手势模式。

所有入口共用一套切口引擎。这套引擎从小样移植过来，改写成 TypeScript 模块，并配上测试。

不在范围内：需求文档 §8 列出的所有内容。

## 2. 本设计依据的事实

| 事实 | 影响 |
| :--- | :--- |
| 中英切换是页面内跳转。2026-11-06 用 11-04 的静态构建在本地实测：切换后页面里的 JS 变量还在 | 可以用同页面的视图过渡。但 P0 发现切换语言时 React 不会发起视图过渡，要自己调 `document.startViewTransition`（§12） |
| 从 404 页回首页是整页加载（同一天实测） | 404 不能用视图过渡，只能原地切开 |
| 视图过渡里，旧页面是静止的快照。按规范，新页面（`::view-transition-new`）是实时画面 | 切口边缘和尘埃可以画在一个单独命名的元素上，过渡期间也能动。**P0 在 Chromium 上确认是实时的（§12）** |
| 本项目装的 `@types/react` 里，`ViewTransitionInstance` 只有 `name` 一个字段 | 切口的形状不靠 React 的实例对象，而是用 `document.documentElement.animate({ clipPath }, { pseudoElement: "::view-transition-new(…)" })` 来驱动。**P0 在 Chromium 上确认可以；Safari、Firefox 没测（§12）** |
| 摄像头 AR 是挂到 `document.body` 的全屏 `fixed` 叠层，开没开记在 `?ar=` 里（`CameraAR.tsx`、`HeroViewport.tsx`） | 摄像头 AR 原地切开：直接给叠层加 `clip-path`，窗里是实时画面 |
| 首页 3D 场景已经画了 OpenCV 风格的角点和坐标轴（`heroScene.ts` 的 `corners()`、`axes()`） | 彩蛋的"工程视角"不能只是角点和坐标轴，要换成正常画面里看不到的东西（§3 D3） |
| three.js 的 `WebGLRenderer` 默认 `stencil: false` | 彩蛋要用模板缓冲（stencil），`createRenderer` 创建时要打开它 |
| 项目详情页现在没有头图，只有标题、简介、按钮和 README | Q7 说"卡片放大成详情页头图"，就要给详情页加一张头图。这和需求 §8"不改现有页面的内容和布局"冲突，已同意修改需求（§11 OQ-2，需求 D6） |
| `Reveal` 让元素从透明度 0、下移 32 px 的状态进场 | 参与共享元素过渡的元素不能放在 `Reveal` 里 |
| MediaPipe Tasks Vision 1.1.1 的 npm 包里有运行库（wasm 和 JS），没有手部模型；模型 7.8 MB，在 Google 的存储上 | 运行库可以从 `node_modules` 复制，模型要另外取（§3 D6） |
| 网站每天由 GitHub Action 重新部署一次（`.github/workflows/refresh-projects.yml`） | 构建时如果要从网上下载模型，下载失败不能让每天的部署失败 |

## 3. 决策

2026-11-06 全部采用 A。

| # | 决策 | 采用（A） | 未采用（B） |
| :--- | :--- | :--- | :--- |
| D1 | 首页取景框和 404 页上，神刀和魔杖怎么共存 | 同一套手势：按下的瞬间杖尖就亮起、开始化开；250 ms 内移动超过 10 px，就收起光点，改成划线；一直不动就是魔杖。不需要切换工具 | 加一个"刀 / 魔杖"切换按钮 |
| D2 | 引擎怎么同时支持"原地切开"和"换页面" | 一份引擎，两种目标：原地切开时给真实元素设 `clip-path`；换页面时用视图过渡加 Web Animations 驱动 `::view-transition-new` 的 `clip-path` | 换页面也用原地切开：先在下面渲染新页面，再切开（要同时挂两个页面，太重） |
| D3 | 彩蛋的工程视角怎么画 | 同一个 WebGL 画布里用模板缓冲画"传送门"：窗外是正常画面，窗里是线框、法线着色、场景图每个节点的包围盒和局部坐标轴 | 再开一个画布（多一个 WebGL 上下文），用 CSS `clip-path` 叠在上面 |
| D4 | 404 的窗里显示什么 | 一个指向首页的 iframe，语言按根路径 `/` 同样的规则来选；穿过去以后再整页跳转 | 跨文档的视图过渡（浏览器支持更窄） |
| D5 | 手势光标的范围 | 只在首页 3D 取景框里：摄像头画面映射到取景框，不映射到整个屏幕；手势用来切彩蛋，也能捏住按取景框里的按钮 | 整页都有光标，捏住可以点任何链接 |
| D6 | 手势模型和运行库怎么放进网站 | 运行库作为 npm 依赖，锁定 1.1.1，构建时把 wasm 复制到 `public/mediapipe/`。模型在构建时下载，校验 SHA-256，放在不提交的目录里；下载失败时构建照常完成，只是隐藏手势开关并打印警告 | 把 7.8 MB 的模型直接提交进仓库 |
| D7 | 项目卡片到详情页 | 给详情页加一张头图，用卡片的同一张封面或线稿；卡片封面放大成这张头图 | 不加头图，只让卡片标题变成详情页的大标题 |
| D8 | 键盘 | 按每个入口"停不停"来决定：会停的入口（摄像头 AR、彩蛋）按 Enter 开一个中等大小的窗并停住；不停的入口（语言切换、404 的按钮）按 Enter 直接切过去。首页取景框改成能用 Tab 聚焦，聚焦时按 Enter 在中心开窗 | 所有入口都先停住 |
| D9 | 点击触发的转场时长 | 划线 120 ms、停顿 40 ms、张开 200 ms、扩张 480 ms，共 840 ms（小样是 1,040 ms，需求要求不超过 1 秒） | 保持小样的 1,040 ms |

## 4. 模块

| 模块 | 职责 | 不得依赖 | 分期 |
| :--- | :--- | :--- | :--- |
| `src/cut/geometry.ts` | 纯函数：直线拟合和判定、透镜形窗口、会起伏的洞口、铺满屏幕要放大的倍数、自动切的直线、点在不在多边形里、多边形转成 `clip-path` | DOM、React | P1 |
| `src/cut/timeline.ts` | 可以取消的补间动画和缓动曲线；时钟和帧调度从外面传进来，方便测试 | DOM、React | P1 |
| `src/cut/gesture.ts` | 输入状态机：鼠标、触屏、笔、手势、键盘的事件变成"划线 / 魔杖 / 点击 / 窗里 / 窗外"等意图，包括 D1 的判定 | DOM、React | P1 |
| `src/cut/dust.ts` | 尘埃粒子：最多 1,500 个，canvas 最多按 2 倍像素比 | React | P1 |
| `src/cut/engine.ts` | 切口引擎：在空闲、划线、化开、张开、停在窗口、穿过去、合上之间切换；画边缘、涟漪、尘埃；调用目标元素的接口设置窗口形状。核心 `createCutController` 不碰 DOM，`createCut` 把它接到真实元素上 | React | P1 |
| `src/cut/fxLayer.ts` | 效果层的 DOM 部分：SVG 画边缘、涟漪、刀痕和杖尖，canvas 画尘埃。颜色写在 style 里，因为 SVG 的属性读不了 CSS 变量 | React | P1 |
| `src/components/CutLayer.tsx` | React 包装：挂上画效果的层，把指针事件交给引擎；只在切口进行中、或者入口开着刀和魔杖时才接指针，其余时候让点击穿到下面。键盘由各入口自己处理，再调用引擎的方法 | | P2 |
| `src/cut/pageCut.ts` | 换页面的切口：先在效果层上画线，再用 `document.startViewTransition` 包住跳转，驱动 `::view-transition-new(root)`（§12 的 P0-1、P0-2） | React 组件 | P2 |
| `Nav.tsx` | 语言按钮：鼠标移上去或获得焦点时预取另一种语言的页面；点击时拦下默认跳转，交给 `pageCut` | | P2 |
| `HeroViewport.tsx`、`CameraAR.tsx` | 摄像头 AR 入口：点按钮从按钮位置切开，窗里先显示"正在打开摄像头"（Q9） | | P2 |
| `global-not-found.tsx` 和它的客户端组件 | 404 的切口，窗里是首页的 iframe | | P3 |
| `heroScene.ts` | 打开 stencil；彩蛋的传送门和工程视角那一遍渲染 | React | P3 |
| `src/cut/hint.ts` | 第一次显示"按住"提示，看过以后记在本地存储里（读写都包在 try/catch 里） | React | P3 |
| `src/cut/hand/oneEuro.ts`、`pinch.ts`、`mapping.ts`、`handInput.ts` | 手势的纯函数：平滑、捏住判定（有回差）、画面坐标到取景框坐标的映射，以及逐帧把一只手变成输入事件 | DOM | P4 |
| `src/cut/hand/tracker.ts` | 打开摄像头，从本站加载 MediaPipe，逐帧识别；拦下 MediaPipe 发给 Google 的使用日志 | React | P4 |
| `src/components/HandMode.tsx` | 手势模式的界面：摄像头小窗、跟手的光标，把手的事件交给彩蛋的切口引擎，捏在按钮上就点它 | | P4 |
| `scripts/fetch-mediapipe.mjs` | 构建前复制运行库、下载并校验模型（D6） | | P4 |
| `src/data/profile.ts` | 新文案的中英文，包括隐私说明里的摄像头说明 | | P2–P4 |
| 项目详情页、`ProjectCard.tsx`、`src/components/ProjectCover.tsx`、`CoverLink.tsx`、`CoverHistory.tsx`、`src/instrumentation-client.ts` | 详情页头图和共享元素过渡（D7）；`ProjectCover` 是两头共用的封面，`CoverLink` 是会放大缩小的链接；`CoverHistory` 和 `instrumentation-client.ts` 里的 `popstate` 监听器让后退、前进也放大缩小 | | P5 |
| `src/cut/coverMorph.ts`、`src/cut/coverHistory.ts` | 这一对的名字、视图过渡的类和过渡类型，以及哪些后退前进要放大缩小；屏幕上是哪一页，和封面缩回时让 `Reveal` 不再淡入的标记（§13 P5） | DOM、React | P5 |

依赖方向：`geometry`、`timeline`、`gesture`、`hand/*` 的纯函数部分不碰 DOM；`engine` 用 DOM 但不用 React；React 组件只是把它们接起来。

## 5. 接口契约

### 5.1 `src/cut/geometry.ts`

```ts
export type Pt = readonly [number, number];
export type Size = { width: number; height: number };
export type Line = { mid: Pt; dir: Pt; normal: Pt; halfLength: number; deviation: number };
export type InputSource = "mouse" | "touch" | "pen" | "hand" | "keyboard";

export function fitLine(points: readonly Pt[]): Line; // 主成分分析
export function checkStroke(line: Line, viewport: Size, source: InputSource): "ok" | "too-short" | "not-straight";
export function lensPoints(line: Line, scale: number, halfWidth: number, sharpness: number, n?: number): Pt[];
export function lensCoverScale(line: Line, halfWidth: number, viewport: Size): number;
export type Blob = { center: Pt; harmonics: readonly { k: number; amp: number; phase: number; speed: number }[] };
export function makeBlob(center: Pt, random: () => number): Blob;
export function blobPoints(blob: Blob, radius: number, wobble: number, timeSeconds: number, n?: number): Pt[];
export function blobCoverScale(blob: Blob, radius: number, viewport: Size): number;
export function autoCutLine(at: Pt, viewport: Size, random: () => number): Line;
export function inPolygon(p: Pt, polygon: readonly Pt[]): boolean;
export function toClipPath(polygon: readonly Pt[]): string; // "polygon(…px …px, …)"
```

阈值都来自 `src/cut/constants.ts`（§7）。随机数从外面传进来，测试时可以固定。

### 5.2 `src/cut/engine.ts`

引擎自己持有 `gesture.ts` 的识别器：调用方只要把指针、手势和键盘事件标准化成 `GestureEvent`（坐标是效果层自己框里的 px）交给 `input`。

```ts
export type Phase = "idle" | "drawing" | "growing" | "opening" | "peek" | "through" | "closing";
export type CutTarget = {
  setWindow(polygon: readonly Pt[] | null): void; // null 表示窗口铺满、目标完全露出来；[] 表示完全藏起来
  setParallax?(dx: number, dy: number, scale: number, origin: Pt): void;
  setFade?(opacity: number): void; // 减少动态效果时代替切口的淡入淡出
};
export type CutOptions = {
  stop: boolean; // 停不停在窗口
  tools: { knife: boolean; wand: boolean; click: boolean };
  reducedMotion: boolean;
  onPhase?(phase: Phase): void;
  onReject?(reason: "too-short" | "not-straight"): void; // 给提示文字用
  onThrough(): void;
  onClose(): void;
};
export type Cut = {
  input(event: GestureEvent): void; // down / move / up / cancel / key
  clickAt(p: Pt): void;             // 点击自动切
  openCentered(): void;             // 键盘：在中心开一个中等大小的窗并停住（D8）
  stepThrough(): void;
  close(): void;
  reset(): void;                    // 丢掉进行中的一切并藏起目标，比如窗口尺寸变了
  isInsideWindow(p: Pt): boolean;   // 给调用方设鼠标指针的样子
  readonly phase: Phase;
  destroy(): void;
};
export function createCut(fx: HTMLElement, target: CutTarget, options: CutOptions): Cut;
// 不碰 DOM 的核心：测试里传假的时钟和渲染器（fxLayer.ts 是真的渲染器）
export function createCutController(renderer: CutRenderer, target: CutTarget, options: CutOptions, deps: { clock: Clock; random: () => number }): Cut;
```

### 5.3 `src/cut/pageCut.ts`

```ts
export const CUT_TYPE = "cut";       // 切口的视图过渡类型
export const FADE_TYPE = "cut-fade"; // 减少动态效果时的淡入淡出（200 ms）
export const PAGE_CUT_MS = 680;      // 过渡里的部分：透镜张开 200 ms，再扩大 480 ms
export function pageCutWindow(line: Line, viewport: Size, ms: number): { polygon: Pt[]; rim: RimStyle }; // 纯函数：某一刻的窗口和边缘
export function pageCutKeyframes(line: Line, viewport: Size): Keyframe[]; // 纯函数：把上面的曲线等间隔取样成关键帧
export function cutNavigate(options: {
  origin: Pt;           // 语言按钮的中心
  navigate(): void;     // router.push(目标地址)
  arrived(): boolean;   // 新页面到了没有，比如 <html lang> 已经是目标语言
  reducedMotion: boolean;
}): Promise<void>;      // 不支持视图过渡时只调 navigate()；新页面 3 秒还没到也照样往下走
// 效果层由 pageCut 自己建，挂在 body 上，只在过渡期间带 view-transition-name: cut-fx。
// 根布局重新挂载后它如果被 React 清掉，就在 update 回调里重新挂回去（P2：切换后它都还在页面上）
```

### 5.4 `src/cut/hand/*`

```ts
export function oneEuro(minCutoff: number, beta: number, dCutoff?: number): { filter(v: number, tMs: number): number; reset(): void };
export function pinchRatio(landmarks: readonly Landmark[], aspect: number): number; // 指尖距离 ÷ 手掌长度，按画面宽高比修正
export function pinchState(prev: boolean, ratio: number): boolean; // ratio < 0.30 捏住，> 0.45 松开
export function handToViewport(landmarks: readonly Landmark[], region: Region, box: Size): Pt; // 镜像
// 逐帧把一只手变成和鼠标一样的输入事件（source "hand"）：张开是移动，捏住是按下，松开或手丢了 300 ms 以上是抬起
export function createHandInput(options?: { region?: Region; lostMs?: number }): {
  frame(landmarks: readonly Landmark[] | null, t: number, aspect: number, box: Size): { cursor: Pt | null; state: "none" | "open" | "pinched"; events: GestureEvent[] };
  release(t: number): GestureEvent[]; // 关掉开关时，捏着的就取消
  reset(): void;
};
// 打开前置摄像头，从本站 /mediapipe 加载运行库和模型（先 GPU，不行再 CPU），每个新的视频帧报一次手的关键点
export function startHandTracking(video: HTMLVideoElement, onFrame: (frame: HandFrame) => void, options?: { base?: string; signal?: AbortSignal; onStatus?(status: "camera" | "model" | "ready"): void }): Promise<{ stop(): void; setPaused(paused: boolean): void }>;
// 失败时抛 HandTrackingError，reason 是 "unsupported" | "denied" | "no-camera" | "model" | "aborted"
export function blockUsageLogging(): void; // 见 §13 P4：不让 MediaPipe 把使用日志发给 Google
```

## 6. 各入口的流程

### 6.1 中英切换（点击自动切，不停）

1. 鼠标移到语言按钮上或按钮获得焦点时，`router.prefetch` 另一种语言的页面（P0-2）。
2. 点击（不带修饰键的左键，或回车）时，`onClick` 拦下 `Link` 的默认跳转，调用 `cutNavigate`。按住 Ctrl、Cmd 点击或中键点击照旧在新标签页打开。
3. 先在活的页面上画线：效果层用 120 ms 从按钮中心画出 `autoCutLine` 给的那条线，再停 40 ms（D9），同时页面数据在加载。
4. 然后调 `document.startViewTransition({ update, types: ["cut"] })`。`update` 里 `router.push`，用 MutationObserver 等 `<html lang>` 变成目标语言就放行，不能等 `requestAnimationFrame`（§12.1）。
5. 过渡就绪后，用 Web Animations 给 `::view-transition-new(root)` 的 `clip-path` 播放 `pageCutKeyframes`：透镜张开 200 ms，再扩大到铺满屏幕 480 ms。切开的是整页，导航栏也一起切。旧页面靠 `html:active-view-transition-type(cut)::view-transition-old(root) { animation: none }` 留着当底。
6. 效果层在过渡期间是实时的（P0 已确认），继续画青色边缘；它的旧快照用 `display: none` 藏掉，分组设 `z-index`。
7. 减少动态效果时，改成 200 ms 的淡入淡出。浏览器不支持时直接切换。

### 6.2 摄像头 AR（点击自动切，停在窗口）

1. 点"试试摄像头 AR"，`HeroViewport` 记下按钮中心，和现在一样 `pushState(?ar=…)`。
2. `CameraAR` 挂载时，叠层先是全部裁掉（窗口为空），然后引擎从按钮中心自动切开，停在中等大小的窗口。
3. 手机上摄像头还没出画面时，窗口中间显示"正在打开摄像头"（已有文案 `cameraAR.starting`），画面出来后淡入（Q9）。
4. 点窗口里面或按 Enter：穿过去，叠层铺满，和现在打开后的样子一样。点外面或按 Esc：窗口合上，然后调用现有的 `closeCameraAR`，按返回键的行为不变。
5. 焦点：停在窗口时，焦点在叠层的关闭按钮上（现有行为）；这时 Enter 只用来穿过去，不会按下关闭按钮。
6. 停在窗口时屏幕底部有一行提示：点里面或按 Enter 进去，点外面或按 Esc 合上。
7. 停在窗口时窗口尺寸变了，叠层直接整个打开。叠层盖满屏幕之前，首页的 3D 画面照常转。

### 6.3 404 页（划一刀或魔杖，不停）

1. 页面上盖一层 `CutLayer`，D1 的手势在整页都能用（404 页不滚动，符合 Q8）。
2. 页面空闲时（`requestIdleCallback`，不支持时用 1 秒的定时器）创建一个隐藏的 iframe，预先加载按根路径规则选出的首页（`/zh` 或 `/en`），用作窗后的世界。直接指向语言页面，不经过 `/` 的跳转。
3. 窗口张开后不停，直接扩张；扩张结束后 `location.replace(首页)`。iframe 和真正的首页内容一样，跳转时只有一次很短的重新加载。
4. "回到首页"按钮改成点击自动切，按 Enter 也一样。

### 6.4 首页 3D 取景框的彩蛋（划一刀或魔杖，停）

1. 在取景框里按下（不在按钮上），D1 判定是神刀还是魔杖。划线期间暂停镜头跟随指针。
2. 引擎的目标是 `heroScene` 的传送门接口：
   - 每帧先正常渲染一遍。
   - 再把窗口多边形转成标准化设备坐标，画进模板缓冲，同时用背景色填满窗口。
   - 最后只在模板值为 1 的地方，画工程视角那一遍（D3）。
3. 停在窗口时可以继续看。点窗口里面就穿过去，整个取景框变成工程视角；在工程视角里再切一次，就切回正常画面。
4. 取景框可以用 Tab 聚焦（D8）。聚焦时按 Enter 在中心开窗。

### 6.5 手势模式（Q11、Q13、D5）

1. 取景框旁边加"用手势试试"的开关，只在电脑上（没有粗指针时）显示。打开后才请求摄像头、加载模型。
2. 摄像头画面里的映射区域对应取景框，光标只在取景框里。捏住等于按下，事件交给取景框的 `CutLayer`，和鼠标走同一条路。在按钮上捏一下，就是点这个按钮。手捏住以后要停一下才出发，所以魔杖等 450 ms 才开始，等的时候光标外圈转一圈金色（§13 P4）。
3. 取景框滚出屏幕时暂停识别；关掉开关就关摄像头。
4. 摄像头小窗贴在取景框的一角，显示骨架、映射区域和状态。

### 6.6 项目卡片到详情页（D7）

卡片封面和详情页头图是同一个组件 `ProjectCover`，外面包一层 `<ViewTransition name={coverTransitionName(slug)} share={{ cover: "cover-morph", default: "none" }} default="none">`，头图不放在 `Reveal` 里。2026-11-06 P5 评审后按实际做法更新（§13）；最初写的是 `name={"cover-" + slug}` 和 `share="morph"`。

1. 名字是 `cover-` 加 slug，CSS 名字里不能有的字符写成 `_十六进制_`：仓库名里可以有 `.`，`view-transition-name` 里不行。
2. 只有过渡类型为 `cover` 的跳转里两头才配对。这样的跳转是卡片的链接和详情页的"全部项目"链接（`CoverLink`），以及同一种语言里进出详情页的浏览器后退、前进（`src/instrumentation-client.ts` 里的 `popstate` 监听器）。导航栏链接、中英切换和其他地方的后退前进都不带这个类型，直接切换（Q7）。`share` 不分类型的话，项目页加载后换上列表时，每张封面也会和自己配成一对，全亮地浮在还透明的卡片上面。
3. 返回列表时反向播放。封面缩回去的那一页，`Reveal` 直接显示，不再淡入，这样封面落下时卡片已经完全显示。
4. 放大缩小用 400 ms。打开"减少动态效果"时封面不移动也不缩放，直接在新位置淡入淡出 200 ms。

## 7. 参数

集中放在 `src/cut/constants.ts`。下表的值先照搬小样，D9 的时长除外。

| 参数 | 值 |
| :--- | :--- |
| 神刀：最短线长 | 屏幕短边的 20%，并且不少于 110 px |
| 神刀：最大偏离 | 线长的 12%；手势时 16% |
| 神刀：停在窗口时的半宽 | 半线长的 34%，限定在 26 px 到短边的 24% 之间 |
| 魔杖：起点延迟、最长按住、最大半径、最小半径、松手后停稳 | 120 ms、1.6 s、短边的 36%、短边的 10%、350 ms |
| 点击自动切 | 划线 120 ms、停顿 40 ms、张开 200 ms、扩张 480 ms（D9） |
| 穿过去的扩张 | 780 ms |
| D1 的判定 | 250 ms 内移动超过 10 px 算划线。手势：40 px；捏住后魔杖等 450 ms 才开始，魔杖开始后 300 ms 内移动仍算划线 |
| 尘埃 | 最多 1,500 个，canvas 最多按 2 倍像素比 |
| 颜色 | 神刀用 `--accent`；魔杖用 `--cat-engines`（`#fbbf6a`，Q10） |
| 手势 | 捏住 0.30、松开 0.45；映射区域左右上各留 12%、下留 18%；手消失 300 ms 算松开；One Euro 1.2 / 0.012 |

## 8. 测试策略

- **单元测试**（Vitest，`node` 环境，放在 `tests/cut/`）：
  - `geometry`：拟合、判定、窗口形状、铺满倍数、点在多边形里。
  - `timeline`：用假时钟测补间和取消。
  - `engine`：用假时钟和假渲染器测各条流程（划一刀、魔杖、D1、点击切的时长、窗口里外、键盘、减少动态效果、重置和销毁）。
  - 架构：`src/cut` 各模块只按 §4 的方向依赖，纯函数模块不碰浏览器全局对象。
  - `gesture`：D1 的阈值，各种输入来源，抬起和取消。
  - `pageCutKeyframes`：每帧的点数相同，最后一帧盖住整个屏幕。
  - `hand/*`：One Euro、捏住的回差、镜像映射。
  - `fetch-mediapipe` 的校验函数。
  - `hint`：本地存储不可用时也不报错。
- **浏览器面板**：
  - 每个入口都过一遍。
  - 减少动态效果、键盘操作。
  - 不支持视图过渡的情况：删掉 `document.startViewTransition` 后，应该直接切换。
  - 手势用模拟的关键点，和小样的测法一样。
- **真机和你的摄像头**：iPhone Safari、Android Chrome，以及桌面的 Chrome、Edge、Firefox、Safari；手势由你用电脑摄像头试。
- **构建检查**：`npm run lint`、`npx tsc --noEmit`、`npm run build` 都没有报错；首页首屏加载的 JS 不变大，因为效果代码都是用到时才加载。

## 9. 分期与规模估算

| 分期 | 内容 | 改动行数（估） | 本期完成后的站点 |
| :--- | :--- | :--- | :--- |
| P0 验证 | **已完成（2026-11-06），结果见 §12。** 在一个不合并的分支上验证四件事：视图过渡里能不能用 Web Animations 驱动 `::view-transition-new` 的 `clip-path`；切换语言时 `<ViewTransition>` 会不会触发 `onEnter`（根布局的参数变了，页面应该会重新挂载）；命名的效果层在过渡期间是不是实时的；three.js 的模板缓冲传送门 | ~150，之后丢弃 | 不变 |
| P1 引擎 | **已合入（2026-11-06，PR #5）。** `geometry`、`timeline`、`gesture`、`dust`、`engine`、`fxLayer`、`constants` 和测试 | ~900 | 不变（新模块还没用上） |
| P2 摄像头 AR 和语言切换 | **已合入（2026-11-06，PR #6），见 §13。** `CutLayer`、`pageCut`、`Nav`、`HeroViewport`、`CameraAR`、文案 | ~450 | F3、F8、F9 可用 |
| P3 404、彩蛋、提示 | **已合入（2026-11-06，PR #7），见 §13。** 404 的客户端组件、`heroScene` 的传送门和工程视角、`hint` | ~600 | F1、F2、F4、F7、F10、F11 可用 |
| P4 手势模式 | **已合入（2026-11-06，PR #8），见 §13。** `hand/*`、`fetch-mediapipe`、开关、小窗、隐私说明 | ~550 | F13 可用（只在电脑上） |
| P5 项目卡片 | **已合入（2026-11-06，PR #10），见 §13。** 详情页头图和共享元素过渡，后退、前进也有：`ProjectCover`、`CoverLink`、`CoverHistory`、`coverMorph`、`coverHistory` | ~120（实际约 270，含注释） | F14 可用（只在桌面 Chromium 里试过） |

合计约 2,600 行（不含 P0），不含测试和文档。每期按"骨架 → 测试（Red）→ 实现（Green）→ 验证"的流程走，结束时停下来评审，并更新需求文档 §5 的状态。

## 10. 风险

| 风险 | 缓解 |
| :--- | :--- |
| 各浏览器对视图过渡伪元素的 Web Animations 支持不一样，特别是 Safari | P0 在 Chromium 上验证可以；Safari、Firefox 没测，做不到的浏览器退回淡入淡出 |
| 效果层在视图过渡期间不是实时的 | P0 在 Chromium 上验证是实时的；别的浏览器不行就只用窗口形状，不画边缘和尘埃 |
| 第一次切换语言要等新页面的数据，过渡开始前画面停住几百毫秒（P0 在静态构建里测到 326 ms） | §12.2 的 P0-2：预取另一种语言的页面，点击后先在活的页面上画线，再开始过渡 |
| 手机上模板缓冲加第二遍渲染太慢 | 只在窗口打开时画第二遍；工程视角用简单材质 |
| MediaPipe 的体积和手机性能 | 先只支持电脑（Q13）；用到时才加载 |
| 构建时下载模型失败 | D6：构建照常完成，隐藏手势开关 |
| 划线和首页镜头跟随指针冲突 | 划线和化开期间暂停跟随 |
| `Reveal` 的 transform 影响 `fixed` 元素 | 叠层和效果层沿用现有的做法，挂到 `document.body` |

## 11. 已定的问题

2026-11-06 全部按建议定下。OQ-2 改动了需求，记在需求文档的 D6。

| # | 问题 | 结论 |
| :--- | :--- | :--- |
| OQ-1 | D1–D9 的决策是否都按建议（A） | 是 |
| OQ-2 | D7 要给项目详情页加一张头图，这会改动现有页面的布局，和需求 §8 冲突。是否同意修改需求、加这张头图 | 同意：头图用卡片的同一张图，放在标题上面 |
| OQ-3 | 彩蛋的工程视角画哪些东西 | 线框、法线着色、场景图每个节点的包围盒和局部坐标轴；首页相机的视锥先不画 |
| OQ-4 | 在彩蛋里穿过去以后，怎么回到正常画面 | 再切一次就切回来；另外按 Esc 也直接回来 |
| OQ-5 | P0 的验证结果如果不理想（比如 Safari 不支持），语言切换怎么办 | 不支持的浏览器用淡入淡出，支持的照常切开 |

## 12. P0 验证结果（2026-11-06）

在 `spike/space-cut-p0` 分支上用临时页面 `/[lang]/spike/{named,auto,stencil}` 验证，开发服务器和静态构建（`out/`）各跑了一遍。浏览器只有 Claude 桌面版内置的 Chromium 152（Windows，像素比 1.5）；Safari、Firefox 和手机都没测。临时代码不合并。

| # | 验证项 | 结果 | 依据 |
| :--- | :--- | :--- | :--- |
| 1 | 用 Web Animations 驱动 `::view-transition-new` 的 `clip-path` | **可以** | `document.documentElement.animate(帧, { pseudoElement: "::view-transition-new(root)" })` 和 React 实例上的 `instance.new.animate(帧)` 都能完整跑完 840 ms，点数相同的 `polygon()` 之间能插值。旧页面要设 `animation: none` 留住，不然它按浏览器默认动画淡出，切口外面一片黑 |
| 2 | 切换语言时 `<ViewTransition>` 触发 `onEnter` | **不会** | 同一语言内跳转时 `onEnter`、`onExit` 都触发，`types` 里有 `cut`。切换语言时页面照样在客户端重新挂载，但 React 根本没调用 `document.startViewTransition`，四个回调都没触发；开发服务器和静态构建结果一样。原因在 React 或 Next 内部，没查到具体位置 |
| 2′ | 替代做法：自己用 `document.startViewTransition` 包住语言跳转 | **可以** | `update` 回调里触发跳转，等 `<html lang>` 变了（MutationObserver）就放行，再驱动 `::view-transition-new(root)`。从点击到过渡就绪：开发服务器上已经访问过的页面 54–74 ms；静态构建里第一次切换 326 ms，这段时间画面停在旧页上 |
| 3 | 命名的效果层在过渡期间是实时的 | **是** | 一个 `view-transition-name: cut-fx` 的 SVG 每帧改一条线的角度；把过渡拉长到 6 秒，中途两张截图里线的角度不同。过渡期间 `requestAnimationFrame` 照常运行（两次 6 秒的过渡分别跑了 201 帧和 360 帧） |
| 4 | three.js 模板缓冲传送门 | **可以** | `WebGLRenderer({ stencil: true })` 拿到了模板缓冲。透镜窗口里是法线着色、线框、包围盒和局部坐标轴，窗口外是普通画面，60 fps。只在一个简单的测试场景里试过，没接首页的真实场景 |

### 12.1 踩到的坑（P1–P3 照着做）

- 视图过渡的 `update` 回调里不能等 `requestAnimationFrame`：这段时间浏览器不渲染，rAF 不会回调，4 秒后过渡超时被放弃。
- 只在带 `cut` 类型的过渡里关掉整页的默认淡入淡出：给 `html:active-view-transition-type(cut)::view-transition-old(root)` 和 `…::view-transition-new(root)` 设 `animation: none`，别的过渡不受影响。
- 效果层的分组要设 `z-index`，不然会被后加入的新页面分组盖住；它的旧快照用 `display: none` 藏掉。
- 模板遮罩：正交相机在 `z = 0` 时，`z = 0` 的遮罩正好落在近平面上被裁掉，要把相机挪到 `z = 0.5`；遮罩材质用 `DoubleSide`，不用管三角形的绕向。
- `@types/react` 的 `ViewTransitionInstance` 只声明了 `name`，运行时其实还有 `group`、`imagePair`、`old`、`new`，后四个都有 `animate()`。没写 `name` 时 React 起的名字形如 `_t_0_`，`instance.name` 能拿到。
- 测试时注意：页面不出帧时（比如 Claude 桌面版的浏览器面板被隐藏），过渡会卡在截取旧画面这一步，`update` 不会被调用，也不会超时；页面一出帧就接着走。P0 里有一次因此停了 41 秒。用户正常浏览时不会遇到。

### 12.2 改动（2026-11-06 采用 P0-1、P0-2）

| # | 改动 | 影响 |
| :--- | :--- | :--- |
| P0-1 | 语言切换不再靠 React 的 `onEnter`。语言按钮的 `onClick` 拦下 `Link` 的默认跳转，改由 `pageCut` 调 `document.startViewTransition({ update, types: ["cut"] })`：`update` 里 `router.push`，等 `<html lang>` 变成目标语言就放行；就绪后驱动 `::view-transition-new(root)`。切开的是整页，导航栏也一起切（它的文字本来就会换语言），去掉 §6.1 第 4 步的"导航栏不动" | 改写 §5.3、§6.1；`pageCut` 变简单，页面外面不用再包 `<ViewTransition>`。不支持视图过渡的浏览器照常跳转 |
| P0-2 | 藏住等新页面的时间：鼠标移到语言按钮上或按钮获得焦点时，预取另一种语言的页面；点击后先在活的页面上画那条线（120 ms，再停 40 ms），同时加载数据，然后才开始视图过渡，窗口张开再扩大（200 + 480 ms）。数据在 160 ms 内到了，总时长约 0.9 秒（含 50–70 ms 的渲染等待）；没到，线就停在那里等 | D9 的时间分配不变，只是前 160 ms 挪到过渡外面画。最坏情况下第一次切换会晚几百毫秒 |
| P0-3 | Safari、Firefox 和手机都没测。OQ-5 的退路保留（不支持就淡入淡出或直接切换），P2 做完后在真机上补测 | 无 |

## 13. 进展

### P2（2026-11-06，已合入，PR #6）

- 网站上：中英切换和"用摄像头看 AR"都是空间切口了。代码在 `src/cut/pageCut.ts`、`src/components/CutLayer.tsx`，改了 `Nav.tsx`、`HeroViewport.tsx`、`CameraAR.tsx`、`globals.css` 和 `profile.ts`。
- 摄像头 AR 停在窗口时，屏幕底部有一行提示（新文案 `cameraAR.peekHint`）；停在窗口时窗口尺寸变了，叠层直接整个打开；叠层盖满屏幕之前首页的 3D 画面照常转。
- 测试：新增 `tests/cut/pageCut.test.ts`（关键帧点数相同、从一条线开始、200 ms 时完全张开、最后盖满屏幕、D9 的时长），架构测试加了 `pageCut` 的规则。
- 桌面 Chromium（Claude 桌面版内置的浏览器）里试过：
  - 中英切换：开发服务器和静态构建都试过，也试过手机宽度下的菜单。旧页面留在切口外面，新页面从透镜里露出来。
  - 静态构建里先悬停预取再点击：从开始过渡到就绪 43 ms（P0 没有预取时是 326 ms）。浏览器面板隐藏时帧率被压低，画线阶段量到 311 ms，设计值是 160 ms，要在可见的浏览器里再看。
  - 减少动态效果（用脚本模拟系统设置）：语言切换改成淡入淡出。
  - 摄像头 AR（桌面上是标定板画面）：点击和按 Enter 都会从按钮切开并停住；点窗里或按 Enter 穿过去，点窗外或按 Esc 合上并关掉叠层，网址退回、焦点回到按钮。
- 没试的：手机（包括"正在打开摄像头"写在窗口中间、画面淡入）、Safari、Firefox。
- 观察到的问题，留给评审：桌面上切口窗口开在按钮那里，正好是标定板画面的黑边，窗里只看到黑色。
- 测试时注意：切换 Git 分支之后，开发服务器可能不再察觉 `globals.css` 的修改，页面一直用旧样式；重启开发服务器就好。

### P3（2026-11-06，已合入，PR #7）

- 网站上：首页 3D 取景框的彩蛋和 404 页都能切了。新增 `src/cut/hint.ts`、`src/components/NotFoundCut.tsx`，改了 `heroScene.ts`（模板缓冲传送门和工程视角）、`HeroViewport.tsx`、`CutLayer.tsx`、`global-not-found.tsx` 和 `profile.ts`。
- 彩蛋：取景框里划一刀或按住魔杖，窗里是工程视角（深蓝图纸底色和网格、法线着色、线框、每个零件琥珀色的包围盒和局部坐标轴）。点窗里或按 Enter 穿过去，两种画面对调，左上角标出"工程视角"；再切一次换回来，Esc 直接回到普通画面。取景框能用 Tab 聚焦，Enter 或空格在中间开窗。划线、化开期间镜头不跟指针；停在窗口时照常跟，窗里窗外一起转，代替视差。HUD 底部一排改成不接指针，只有按钮接，所以按钮旁边也能起笔。
- 404 页：接指针的那一层垫在卡片下面，卡片里的按钮照常能点；效果层挂到 body 上，画在所有东西上面。窗后是页面闲下来时预加载的首页 iframe（语言规则和根路径 `/` 一样）；点"回到首页"或"Back to home"从按钮中间切开，首页的语言跟着按钮走。切到底以后 `location.replace` 到首页。
- 提示：第一次把鼠标移到能用魔杖的地方（取景框、404 页的空白处），指针旁边出现"按住"的提示，按下去或 4.5 秒后收起，记在本地存储里；只有触屏的设备上，这一层露出六成以上时在底部出现。划得太短、不够直，底部会提示；停在窗口时，底部有怎么进去、怎么合上的提示。
- 测试：新增 `tests/cut/hint.test.ts`（没有本地存储、读写被拒时都不报错），架构测试加了 `hint` 的规则。
- 首屏代码：彩蛋的切口层等 3D 画面准备好以后才下载，首页首屏的脚本里没有切口代码；首屏比 P2 多了约 1.3 KB（取景框的键盘处理和新文案）。
- 桌面 Chromium 里试过：彩蛋的"按住"提示、划一刀开窗、点窗里穿过去、Esc 回来、Enter 开窗、Esc 合上并留下切痕；404 页（静态构建）在空白处起笔划过卡片、点"Back to home"，都切开并跳到了首页。
- 没试的：魔杖在这两处（这里的浏览器工具做不了按住不放；P1 的临时页面上试过魔杖）、触屏上的提示、手机、Safari、Firefox。开发服务器在 `output: "export"` 模式下打不开 404 页（原本就是这样），要用静态构建测。
- 留给评审：手机上 404 页的卡片几乎占满屏幕，能起笔的空白很少（可以从边缘起笔划过卡片）。

### P4（2026-11-06，已合入，PR #8）

- 网站上：首页 3D 取景框右下角多了"用手试试"开关，只在电脑上、浏览器能开摄像头、并且这次构建拿到了模型时出现（Q11、Q13、D6）。打开后才请求摄像头、加载模型；右上角的小窗显示镜像画面、手的骨架、映射区域的虚线框和状态（正在打开摄像头、正在加载模型、没看到手、张开、捏住）；光标跟着手走，捏住时缩成金色实心点，几秒的提示说明怎么用。捏住就像按下鼠标，和鼠标走同一条路交给彩蛋的切口引擎：捏着划直线是刀，捏住不动是魔杖，停在窗口时捏在窗里穿过去、窗外合上。捏在取景框里的按钮上就是点它（D5）。取景框滚出屏幕时停止识别；关掉开关、或者打开摄像头 AR 时摄像头随即关闭。打不开摄像头、没有权限或模型加载失败时，开关弹回，并说明原因。
- 新增模块：`src/cut/hand/oneEuro.ts`、`pinch.ts`、`mapping.ts`、`handInput.ts`（逐帧把手变成输入事件，纯函数）、`tracker.ts`，`src/components/HandMode.tsx`，`scripts/fetch-mediapipe.mjs`。依赖加了 `@mediapipe/tasks-vision` 1.1.1（固定版本）。
- 构建（D6）：`predev` 和 `prebuild` 先跑 `fetch-mediapipe`：把两份运行文件（支持 SIMD 和不支持的，各约 13 MB 和 12.6 MB）复制到 `public/mediapipe/wasm/`，下载模型（7,819,105 字节）并按 SHA-256 校验，已经有且校验通过就跳过。这些文件不提交。模拟断网时脚本照常退出、把标记写成不可用、删掉下了一半的文件，首页就不显示开关。ESLint 不检查复制过来的运行文件。
- 发现的问题：MediaPipe 1.1.1 每创建一个识别任务就会建一个使用日志客户端，每分钟往 `https://odml.pa.googleapis.com/v1/log` 发一次，没有关掉的选项（P4 的临时页面上实测到 4 个请求）。这违反 Q12"访客不连 Google"。做法：加载 MediaPipe 之前包一层 `fetch`，只把这个地址就地回 403，日志客户端收到失败就停止发送；其他请求照常。加上以后实测没有任何外部请求，识别照常。
- 隐私说明加了两条：摄像头只在打开摄像头 AR 或"用手试试"时使用，画面只在浏览器里处理、不上传不保存，模型和运行文件都由本站提供；"按住"提示会在本地存储里记一个标记。
- 测试：新增 `tests/cut/hand/hand.test.ts`（One Euro、捏住判定和回差、镜像映射、逐帧事件、手丢了 300 ms 才算松开、关掉时取消）、`fetchMediapipe.test.ts`（SHA-256 校验、固定的版本和哈希、运行文件都在）、`tracker.test.ts`（日志地址被拦下、其他请求照常），架构测试加了 `src/cut/hand` 各模块的规则。
- 首屏代码：手势模式和 MediaPipe 打开开关才下载，首页首屏的脚本里没有它们；首屏比 P3 多了约 1.1 KB（开关和文案）。
- 浏览器里试过（桌面 Chromium）：开关出现；Claude 桌面版内置的浏览器不允许页面用摄像头，所以只走到了"没有拿到摄像头权限"那一步，开关弹回并说明原因。另用一个不提交的临时页面从本站加载运行文件和模型，GPU 和 CPU 都能建出识别器并跑一次识别（约 0.2–0.8 秒）。
- 你用摄像头试过（2026-11-06）：整体不错，但刀和魔杖不好区分，准备划开时经常先化开了。原因：捏住时魔杖马上开始，只有捏住后 250 ms 内移动超过 40 px 才算划线；手捏住以后要停一下才出发，这时魔杖已经开始了。改法（只对手势，而且刀和魔杖都开着时）：捏住后魔杖等 450 ms 才开始，这之前移动超过 40 px 就是刀；魔杖开始后 300 ms 内这样移动仍改成刀（刚化开的小洞很快收起）。捏一下马上松开仍是魔杖的轻点。等的时候光标外圈转一圈金色，定下来以后光标变成金色实心点（魔杖）或青色实心点（刀）。提示文案也说了这一点，显示时间从 6 秒改成 8 秒。鼠标和触摸不变。`gesture.test.ts`、`engine.test.ts` 加了测试；金圈在浏览器里手动渲染光标检查过。你又用摄像头试过，等 450 ms 合适。
- 没试的：手机（Q13 先不给手机）、Safari、Firefox。

### P5（2026-11-06，已合入，PR #10）

- 网站上：项目详情页的标题上面多了一张头图，就是卡片自己的封面（README 里的截图，没有截图时是线稿，带四角的取景框标记），和卡片一样 16:10，宽度不超过下面的简介（672 px），不在任何 `Reveal` 里，立刻加载。在项目页或首页的精选项目里点一张卡片（鼠标或 Enter），卡片封面在 400 ms 里放大成头图，分类标签在路上淡出。回去时封面缩回卡片：详情页的"全部项目"链接，以及浏览器的后退（回到项目页或首页）都会；前进再放大一次。页面其余部分和以前一样直接换掉。封面缩回去的那一页，卡片直接显示，不再淡入（见下文）。打开"减少动态效果"时封面不移动也不缩放，直接在新位置淡入淡出 200 ms。
- 新增：`src/cut/coverMorph.ts`（这一对的名字、类 `cover-morph`、过渡类型 `cover`、哪些后退前进要放大缩小）、`src/cut/coverHistory.ts`（屏幕上是哪一页、进来时的标记）、`src/instrumentation-client.ts`（后退、前进的监听器）、`src/components/ProjectCover.tsx`（卡片和头图共用的封面）、`src/components/CoverLink.tsx`（卡片的链接和"全部项目"）、`src/components/CoverHistory.tsx`（什么都不画，放在 `[lang]` 的布局里）。改了 `ProjectCard.tsx`、`src/app/[lang]/projects/[slug]/page.tsx`、`src/app/[lang]/layout.tsx`、`Reveal.tsx`、`CoverImage.tsx`（头图用的 `priority`）和 `globals.css`。
- **和最初的 §6.6 不同的两处**（2026-11-06 你同意了，§6.6 已改成这样）：
  1. 名字是 `cover-` 加 slug，CSS 名字里不能有的字符写成 `_十六进制_`。仓库名里可以有 `.`，`view-transition-name` 里不行。
  2. 只有过渡类型为 `cover` 的跳转里两头才配对，两头用 `share={{ cover: "cover-morph", default: "none" }}`，不是 `share="morph"`。卡片的链接和"全部项目"带上这个类型（`CoverLink`），进出详情页的后退、前进也带。原因：`share` 不分类型时，项目页的筛选栏在页面加载后马上把 Suspense 的占位换成真正的列表，每张封面都和自己配成一对。Chromium 画配对的封面时不算外层的透明度，所以卡片的 `Reveal` 还在淡入时，封面已经全亮地浮在卡片上面，分类标签也被盖住 400 ms（把过渡停在 190 ms 时看到的）。`share` 不分类型时，点导航栏的链接也会放大缩小（Q7 定的是导航栏链接什么都没有），首页的精选卡片和列表的卡片之间也会互相飞。
- 后退、前进（2026-11-06 评审后按你的要求加上）：
  - Next 不给后退、前进加过渡类型，它自己的还原也不会单独作为 Transition 提交。所以在 `instrumentation-client.ts` 里注册一个 `popstate` 监听器：它在 React 接管页面之前注册，总排在 Next 的前面，另起一个带 `cover` 类型、带一次没用的状态更新（`CoverHistory` 里）的 Transition，React 把它和 Next 的还原一起提交，封面就配成对。只在同一种语言里进出详情页时这样做（`morphsOnTraverse`）：首页和列表之间、两个详情页之间、跨过中英切换的后退前进，都还是直接切换。
  - 记一下没走通的两种做法：同样的监听器放在 `CoverHistory` 里注册，切换语言以后就不灵了，因为根布局重新挂载，监听器排到了 Next 后面，而 React 会把 `popstate` 里的第一个 Transition 同步提交掉。在 Next 的 `onRouterTransitionStart` 里加类型，类型确实记到了根上，可还原从来不作为 Transition 提交，类型一直排着，会漏到下一次跳转上。
  - 落下的那一刻：封面缩回的那张卡片在 `Reveal` 里，开始时是透明的，所以封面全亮地先到，卡片本身还只有 9% 的不透明度（第六张卡片，停在 330 ms 时量的），过渡结束时封面还会暗下去。现在 `CoverLink` 和后退的监听器在这样的跳转前打一个标记，新页面的 `Reveal` 第一次渲染时读到它就直接显示，第一个读到的清掉它（2 秒后也会自己失效）。这样同一时刻卡片是 100%。普通跳转照常淡入；那一页后来再出现的卡片（比如换了分类）也照常淡入。
  - 后退回到列表时还在你离开的位置（浏览器恢复滚动），卡片一般就在屏幕上。"全部项目"打开的是列表顶部，卡片不在屏幕上时就不放大缩小。
- 发现的情况：
  - 跳转里没有配成对时（导航栏链接、上一个和下一个项目、卡片页之间的后退），React 不发起视图过渡，日常跳转和以前完全一样。放大缩小时 React 自己就不截整页（把 `<html>` 的 `view-transition-name` 设成 `none`），页面其余部分直接换掉；`globals.css` 另外让 `cut`、`cut-fade` 以外的过渡里整页不淡入淡出，作为保险。
  - 中英切换不变：只有一次 `cut` 类型的过渡，头图不会被单独拎出来（在项目页和详情页、开发服务器和静态构建上都试过）。
  - 放大缩小要求新页面和跳转在同一次提交里出现。Vercel 会返回逐段预取的文件（yu-cao.vercel.app 上 `…/__next.$d$lang.projects.$d$slug.__PAGE__.txt` 返回 200），P2 以来用的本地静态服务器却对它们返回 404。这时 Next 点击时才去取整页，页面打开约 20 秒以后再点，会先提交一个空白页面，配不成对，变成直接切换。换成像 Vercel 那样映射这些路径的本地服务器，打开 25 秒后再点也能放大。预取 5 分钟后过期（Next 的默认值），过期后可能也会这样，没试。
  - 开发服务器上改了 `CoverHistory` 相关的模块，Fast Refresh 会整页刷新；和网站本身无关。
- 测试：`tests/cut/coverMorph.test.ts`：任何仓库名都得到合法且不重复的名字；只在 `cover` 类型下配对；哪些后退前进要放大缩小（详情页和列表或首页之间来回要，两个详情页之间、两个卡片页之间、两种语言之间不要）；两头都用 `ProjectCover` 和 `CoverLink`，由 `CoverLink` 带上类型；头图不在 `Reveal` 里；`globals.css` 保留切口自己的规则，整页规则排除切口的两个类型，减少动态效果时放大缩小停住。`tests/cut/coverHistory.test.ts`：后退监听器按屏幕上的页面判断，`CoverHistory` 挂载之前什么都不做；后退到卡片页时打上标记，前进到详情页时不打，标记会自己失效。架构测试加了 `coverMorph`、`coverHistory` 的规则。
- 首屏代码：每一页多了一个小小的 `popstate` 监听器和 `CoverHistory`，`Reveal`、`CoverImage` 也大了一点。没有和 `main` 对比测量。
- 桌面 Chromium 里试过（Claude 桌面版内置的浏览器；面板大部分时间是隐藏的，帧率被压低，所以从点击到页面更新量到的时间说明不了什么）。开发服务器和静态构建（按上面那样映射路径）都试过：
  - 英文和中文里，从项目页和首页点卡片进详情页，鼠标和 Enter 都试过。
  - "全部项目"，点击和按 Enter：反向播放。
  - 从详情页后退到列表、再前进，以及切换语言以后再这样做（静态构建，中英文）：反向播放和放大，之后 React 的根上没有残留的类型。靠后的卡片（第六张）封面落下时卡片已经完全显示。
  - 跨过中英切换、首页和列表之间、两个详情页之间的后退前进，以及导航栏链接：直接切换。
  - 项目页和详情页上的中英切换：和以前一样切开。
  - 模拟 375 px 的手机宽度：能放大，头图占满宽度，没有横向滚动（在加后退之前试的，之后没再试）。
  - 减少动态效果：面板没法让 CSS 的媒体查询生效，所以用脚本把 `@media (prefers-reduced-motion: reduce)` 里的规则直接加到页面上试的（在加后退之前试的，之后没再试）。
- 没试的：手机（包括滑动返回）、Safari、Firefox、系统自己的"减少动态效果"设置、线上网站（随 PR #10 部署了，还没在线上试）、页面打开 5 分钟以后再点。
- 留给评审：头图保持卡片的 16:10，放大缩小只是等比缩放，左右并排的截图也和卡片一样只露出右半边。桌面上它在标题上面占 420 px 高。
- 测试静态构建时注意：要像 Vercel 那样返回逐段预取的路径（见上），否则页面开得久一点，点卡片就不放大了。

### 你的验收（2026-11-07）

- 你在线上网站上试过：电脑上用 Chrome 或 Edge 和 Safari，手机上用 iPhone；试了语言切换、摄像头 AR、首页取景框的彩蛋、404 页和项目卡片放大成头图，也查过键盘操作，没发现大问题。上面 P2–P5 "没试的"里，iPhone、Safari 和线上网站现在都试过了。
- 还没试的：Android Chrome 真机、Firefox、系统自己的"减少动态效果"设置。手势模式这次没有单独验收。
