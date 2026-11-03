# 测试计划：标定板上的摄像头 AR

状态：**已于 2026-11-02 确认**；P1 已转绿；P2a 测试已写好，先对骨架代码全部为红（本计划 §9），现已转绿，OQ-69–OQ-70 的补充用例也已通过 · 设计文档：`docs/design_camera_ar.md`（已定细节见其 §14）· 英文版：`docs/test_plan_camera_ar.md`（以英文版为准，两版逐节同步）

本计划把设计文档的接口契约（§5，及 §6 的坐标约定、§9 的测试策略）按阶段（设计文档 §10）映射到测试用例。决策 D1–D14 均取方案 A。契约原先没有定义的 60 个问题都已定下（本计划 §10）：除 OQ-04、OQ-06、OQ-09、OQ-27、OQ-47 外均取方案 A。编写 P2a 测试时又提出了 OQ-61–OQ-68，评审时又提出了 OQ-69–OQ-70，均取方案 A。"§5.2" 这类编号指设计文档，"本计划 §x" 指本文档。

因决议而删除的用例（编号不再复用）：P1-DET-11（OQ-09）、P2-PNP-06（OQ-19）、P3-TRK-41（OQ-47）、P3-COPY-01、P3-COPY-02 和 P4-COPY-01（OQ-04），以及 M3-20（OQ-03）。

## 1. 范围与约定

### 1.1 测试运行器与文件

- Vitest 4.1.12 搭配 vite 8.3.4。`vitest.config.mts` 设为 `node` 环境，包含 `tests/**/*.test.ts`，并把 `@` 指向 `src`；`npm test` 运行 `vitest run`。测试从 `"vitest"` 显式导入 `describe`、`it`、`expect`（不用全局变量）。不用 jsdom 和 Testing Library：界面和 WebGL 行为手动检查（本计划 §8）。
- 开发依赖 jpeg-js 0.4.4 用来解码实拍照片。只有少数 P2 用例引入 three.js，用 `THREE.Matrix4` 核对矩阵元素顺序；它的数学类在 Node 里能直接运行。

| 文件 | 覆盖 | 阶段 |
| :--- | :--- | :--- |
| `tests/ar/helpers.test.ts` | 辅助工具自检 H-01…H-11 | P1（H-09 属 P3，H-10 属 P4） |
| `tests/ar/board.test.ts` | P1-BRD | P1 |
| `tests/ar/chessboard.test.ts` | P1-GRY；P1-DET-01…25：参数校验、结果布局、角点顺序、精度 | P1 |
| `tests/ar/chessboard.reject.test.ts` | P1-DET-26…38：拒识、靠近图像边缘 | P1 |
| `tests/ar/chessboard.tracking.test.ts` | P1-DET-39…57：跟踪提示、确定性、不修改输入 | P1 |
| `tests/ar/chessboard.perf.test.ts` | P1-PERF | P1 |
| `tests/ar/fixtures.test.ts` | P1-FIX（实拍照片，D12） | P1 |
| `tests/ar/pose.test.ts` | P2-INT、P2-PNP、P2-FOC、P2-VM、P2-PM、P2-CP、P2-CHN | P2 |
| `tests/ar/filter.test.ts` | P2-CF、P2-FT | P2 |
| `tests/ar/pipeline.test.ts` | 用真实模块的 P2-PIP 用例 | P2 |
| `tests/ar/pipeline.spy.test.ts` | 对 `chessboard` / `pose` 做 spy 或 mock 的 P2-PIP 用例 | P2 |
| `tests/ar/options.test.ts` | P2-OPT | P2 |
| `tests/ar/worker.test.ts` | P2-WRK、P2-WKE | P2 |
| `tests/ar/arch.test.ts` | P2-ARCH、P3-ARCH（OQ-03） | P2、P3 |
| `tests/ar/tracker.test.ts` | P3-TRK | P3 |
| `tests/app/chessboard-pdf.test.ts` | P4-PDF | P4 |

辅助代码放在 `tests/ar/helpers/`：`random.ts`、`boardModel.ts`、`linalg.ts`、`render.ts`、`scenes.ts`、`catalog.ts`（P1 的全部场景）、`metrics.ts`、`fixtures.ts`（读取照片）、`poses.ts` 和 `poseCatalog.ts`（P2：位姿相关的数学和 P2a 的全部带种子输入），P3 起还有 `cameraFakes.ts`。PDF 解析器只给路由测试用，放在它旁边的 `tests/app/helpers/pdf.ts`。实拍照片和清单放 `tests/fixtures/board/`。

模块 mock（`vi.mock`）只出现在 `pipeline.spy.test.ts`，而且只针对 §5.4 自己规定了的调用：带提示的检测调用、`estimateFocal` 和 `solvePlanarPnP`。其余一律通过公开接口测试。

### 1.2 表格里用到的术语

| 术语 | 含义 |
| :--- | :--- |
| 真值（truth） | 渲染器给出的角点真值（float64），按所请求点阵尺寸的规范 O1–O3 顺序排列（本计划 §2.3） |
| 准确（accurate） | 新建的长度为 2 · cornersX · cornersY 的 `Float32Array`，逐点对比真值的 RMS 误差 ≤ 0.25 px、最大误差 ≤ 0.6 px（§5.2），且在结果上测得的 O2、O3 成立。真值本身是规范顺序，所以这也证明了 O1–O3 |
| 编号正确（identity-correct） | 非 null、长度正确，且每个角点离它自己的真值角点不超过局部角点间距的 0.3 倍：即标称条件之外"不算错误结果"的含义（OQ-10） |
| null 或准确、null 或编号正确 | 要么是 `null`，要么是满足上述定义的结果 |
| 标称条件（nominal） | §5.2「标称条件下的精度」中列出的条件，由场景生成器核验（本计划 §2.3） |
| S0 | 基准正例场景：640×360，9×6 标定板，倾角 15°，面内旋转 10°，最短格边 22 px，暗 40 / 亮 200，白边 0.5 格，背景 128，模糊 σ 0.6 px，噪声 σ 2 |
| 最短格边（min edge） | 全部 70 个格子投影后最短的一条边，单位 px |
| 倾角（tilt） | §5.2 的定义：标定板法线与指向标定板中心的视线之间的夹角。对 `estimateFocal` 而言是法线与光轴的夹角（OQ-23） |

### 1.3 测试中体现的决策

D1–D14 均取方案 A。

| 决策 | 体现它的用例 |
| :--- | :--- |
| D1 由标定板估计焦距 | P2-FT-*、P2-PIP-09…11、P2-PIP-19、P2-PIP-22 |
| D3 丢失后保留最后位姿 0.5 s | P3-TRK-23…26 |
| D4 后置摄像头，无切换按钮 | P3-TRK-05、P3-TRK-06 |
| D8 A4 PDF | P4-PDF-* |
| D12 实拍照片样例 | P1-FIX-* |
| D2、D5、D6、D7、D9、D10、D11、D13、D14 | 手动检查清单（本计划 §8） |

## 2. 测试辅助工具

### 2.1 带种子的随机数（`random.ts`）

- `mulberry32(seed)`：32 位整数随机数发生器（`Math.imul`、`>>> 0`），在任何平台上给出相同序列。其上提供 `uniform()`、`range(a, b)`、`int(n)`、`gaussian()`（Box–Muller，u₁ ∈ (0, 1]）和 `pick()`。
- `seedFor(label)`：对 `"P1-DET-12#7"` 这样的标签做 FNV-1a 哈希，每个用例有自己的随机序列，新增用例不会改变其他用例的数据。
- 种子和试验次数是测试文件和场景目录里的常量。单元测试中不使用 `Math.random`、`Date.now` 和真实定时器。

### 2.2 独立的标定板模型（`boardModel.ts`）

- 通用标定板：cornersX × cornersY 个内角点，(cornersX + 1) × (cornersY + 1) 个边长 s（默认 0.24）的格子，以原点为中心：角点 (i, j) 位于 ((i + 1 − (cornersX + 1)/2) · s, (j + 1 − (cornersY + 1)/2) · s)；格子 (r, c) 当且仅当 r + c 为偶数时是暗格。
- 按 §5.1 独立编写，不依赖 `src/ar/board.ts`，这样 `boardCorners()` 的错误不会混进真值。P1-BRD-06 核对两者一致。

### 2.3 合成棋盘格渲染器（`render.ts`）

输入：标定板参数（点阵尺寸、格子大小、白边宽度（格，默认 0.5））、映射、图像尺寸、灰度（暗、亮、白边（默认同亮格）、背景灰度或生成器），以及可选的光照增益、反光、遮挡物、翻色的格子、额外的标定板、运动模糊、高斯模糊 σ、噪声 σ、色调分离和种子。

从标定板平面到图像的映射二选一：
- `homography`：3 × 3 矩阵 H（标定板 XY → 像素），用于辅助工具自检；
- `camera`：(K, R, t)，H = K · [r₁ r₂ t]，所有检测器场景都用它，这样倾角有明确定义。

逐像素 (u, v) 渲染：
1. §6 的像素中心约定：像素 (u, v) 覆盖 [u − 0.5, u + 0.5] × [v − 0.5, v + 0.5]。
2. 4 × 4 超采样：16 个采样点放在错切网格上，偏移量为 ((4a + b + 0.5)/16 − 0.5, (4b + a + 0.5)/16 − 0.5)，a、b ∈ {0, 1, 2, 3}。每个轴上有 16 个不同偏移，与坐标轴平行的边被量化到 1/16 px（偏差 ≤ 1/32 px）。普通 4 × 4 网格量化到 1/4 px（偏差可达 0.125 px），会把 0.25 px RMS 误差预算的一半耗在测试图本身上。
3. 每个采样点经 H⁻¹ 映射；齐次坐标非正表示视线到不了平面（算背景）。落在格子区域按 r + c 规则取暗或亮（翻色的格子相反）；落在白边取白边灰度；其余取背景。遮挡物（圆盘、矩形、多边形；图像坐标或标定板坐标；纯色或带纹理）逐采样点叠加在最上层。
4. 采样平均得到线性灰度（不做 gamma）。
5. 光照增益 g(p) = 1 + a · ((p − c) · d) / e，c 是标定板中心在图像中的位置，d 是单位方向，e 是标定板沿 d 的半宽，标称场景中 |a| ≤ 0.25。作用于整幅图像。
6. 反光：叠加的光斑，strength · exp(−d² / 2r²)。
7. 水平方框模糊（运动），然后可分离高斯模糊：采样权重，半径 ⌈4σ⌉，边界用钳位延伸。
8. 按种子生成指定 σ 的加性高斯噪声，可选色调分离，最后四舍五入并钳位到 [0, 255]。

`describeScene(options)` 只给出几何信息、不绘制；`render(options)` 再加上图像：
- `physical`：按标定板自身 (i, j) 编号的 float64 角点位置 H · (X, Y)；`H`：标定板 → 像素。
- `truth(cornersX, cornersY)`：把 `physical` 重新排成对所请求尺寸唯一满足 O1–O3 的顺序。辅助函数逐一尝试点阵的对称变换（请求的尺寸是转置时，尝试转置后的变换），保留 cross > 0 且向外格子在标定板模型中为暗格的那一种。在 camera 映射下请求 (9, 6) 时就是 `physical` 的顺序（H-05）；请求 (6, 9) 时为 T(i′, j′) = physical (j′, 5 − i′)。
- `meta`：最短格边、倾角、每个内角点到图像边缘的有符号距离、标定板加 0.25 格白边是否都在图内、增益之后的最小明暗对比度，以及 `nominal` 标志和不满足的条件名（`minEdge`、`tilt`、`margin`、`marginLevel`、`inside`、`contrast`、`blur`、`noise`、`gain`、`occluded`、`flipped`、`extraBoard`、`motion`、`posterize`、`glare`）。

开销：一帧 640×360 需 10–40 ms；渲染目录中全部 305 个场景约 6.5 s。

关于镜像：10×7 标定板的配色关于长轴对称，所以标定板的镜像图像与某个未镜像视图逐像素相同，而面内旋转 180° 等于黑白反色。因此镜像和反色标定板不需要单独的用例，P1-DET-08 同时覆盖两者。

### 2.4 场景生成器与场景目录（`scenes.ts`、`catalog.ts`）

- `placeBoard({ width, height, hfovDeg, inPlaneDeg, tiltDeg, tiltAxisDeg, normalRef, centre, minEdgePx | widthFraction | depth })`：取指向目标中心的视线 d，让法线相对 d（`normalRef: "ray"`，即 §5.2 的倾角）或相对光轴（`"axis"`，用于精确的正对放置）倾斜 τ。R = [X̂ Ŷ n]，X̂ 按面内角旋转，Ŷ = n × X̂。深度按所要求的最短格边或宽度二分求得，并保证标定板上每一点都在相机前方。
- `sampleScene` / `nominalScene`：在 §5.2 的条件范围内采样（面内旋转 0–360°，绕任意轴倾斜 0–60°，最短格边 12–30 px，模糊 0–1.0，噪声 0–4，增益后对比度 80–160，60 % 的场景带 ±0.25 的增益，白边 0.25–1 格，背景均匀或杂乱），用有限次数、确定性的拒绝采样，取第一个 `meta` 被调用方接受的场景（标称的，或者恰好只因预期原因而不标称的）。增益之后每一处对比度都保持 ≥ 80（OQ-12）。
- `clutter(rng, kind)`：随机矩形、类似文字的笔画行、方格纸、9×6 点阵。
- `moveScene(scene, kind, direction, shift)`：平移、旋转、缩放或改变倾角，用二分使最大角点位移恰为 `shift` × 最短投影格边（OQ-15）；`shiftInSquares` 负责测量。
- `catalog.ts` 把 P1 检测器测试用到的每个场景记为一项：标签、渲染参数、请求的点阵尺寸，以及对该测试所需条件的检查（标称；仅因预期原因而不标称；没有标定板；有角点在图外 ≥ 4 px；最近的角点落在给定区间；移动后场景的实测位移）。辅助工具自检 H-11 只凭几何信息运行全部检查，不调用检测器。`renderItem` 在每个测试文件里对每项只渲染一次。

### 2.5 度量、断言与位姿辅助代码（`metrics.ts`、`linalg.ts`、`poses.ts`、`poseCatalog.ts`）

- `cornerErrors(result, truth)`：逐点距离、RMS 和最大值。
- `expectLayout`、`expectAccurate`、`expectIdentityCorrect` 及其 `expectNullOr…` 形式；`expectAccurate` 还会运行 `expectOrderProperties`（O2 由角点 0 处的叉积判断，O3 由图像判断）。
- `crossAtCorner0(result, cornersX)`；`outwardSquareContrast(image, result)`：对结果拟合单应，比较角点 0 斜外侧格子与其两个亮色邻格的 5 × 5 采样块均值。
- `fitHomography(src, dst)`：归一化 DLT（Hartley 归一化，9 × 9 Jacobi 特征值求解，并统一符号使源点在前方）及其几何 RMS 残差。
- `rotationAngle(Ra, Rb)` = atan2(‖vee(M − Mᵀ)‖ / 2, (tr M − 1) / 2)，M = Ra · Rbᵀ，在 1e−6 rad 附近仍然准确（供 P2 使用）。
- `expectRangeError(call)`：遇到 `RangeError` 即通过，其他异常原样抛出，因此在 Red 运行中参数校验用例失败时报的就是桩函数自己的 "not implemented"。
- `bytesOf(view)` 复制类型化数组背后的字节，用于检查是否被修改；`toFloat32` 用来构造提示。
- `poses.ts`（P2）：带种子的标定板摆放（`samplePose` 在给定范围内采样，`placeRotated` 按给定旋转摆放）、不检查 z 符号的精确针孔投影、高斯像素噪声、§5.3 定义的重投影 RMS、P2-PNP-10 用来比较的仅由单应得到的位姿（K⁻¹ 乘以 `fitHomography` 的结果，λ 取两列范数的均值并使 t_z > 0，R 由极分解取最近的旋转）、§6 的矩阵 B 和 F、列主序 4 × 4 乘法与行列式，以及从布局（而不是 §5.3 的公式）推导出的 cover 适配下像素到 NDC 的映射。
- `poseCatalog.ts`（P2）：P2a 的全部带种子输入，每次试验一个随机流（对试验标签取 `seedFor`），因此同组测试共用试验，离线检查也能重放。

### 2.6 `startCameraAR` 的替身（`cameraFakes.ts`，P3）

| 替身 | 行为 |
| :--- | :--- |
| `deferred<T>()` | `{ promise, resolve, reject }`，在指定时刻让 `getUserMedia` 和 `play()` 完成或失败 |
| `FakeTrack` | `kind`、`readyState`（"live" → "ended"）、计数的 `stop()` |
| `FakeStream` | 基于一到两个 `FakeTrack` 的 `getTracks()`、`getVideoTracks()`、`getAudioTracks()`；用在需要 `MediaStream` 的地方 |
| `fakeMediaDevices()` | `getUserMedia` 的 spy，返回当前的 deferred 并记录约束参数 |
| `FakeVideo`（`VideoLike`） | `videoWidth`、`videoHeight` 可设置；记录每次 `srcObject` 赋值；`play()` 返回 deferred，并记录调用时的 `srcObject` |
| `FakeWorker`（`WorkerLike`） | `postMessage(msg, transfer)` 记录消息和转移列表，然后执行 `structuredClone(msg, { transfer })`，让发出的 buffer 像浏览器里一样真的被分离。`respond(partial)` 用收到的 buffer 组装 `result` 回复，再经一次带转移的 `structuredClone` 交给 `onmessage`，主线程拿到的是一个新的 `ArrayBuffer` 对象，与浏览器一致。`respondError(message)`；`crash(event)` 触发 `onerror`；`terminate()` 计数，并保留最后的处理函数，便于测试模拟迟到的事件 |
| `createWorker` | 返回新 `FakeWorker` 并记录所有实例的 spy |
| `captureFrame` | spy：检查 `out.length === 4 · w · h` 且其 buffer 未被分离，然后在 `out` 里写入编码了帧序号的图案 |
| `ManualScheduler`（`requestFrame`） | 保存回调；`tick()` 只运行此刻挂起的回调（先进先出；tick 中新请求的回调等下一次）；返回的取消函数把对应项标为已取消 |
| `ManualClock`（`now`） | `set(ms)`、`advance(ms)` |
| `recorder()` | 一个 `onUpdate`，保存每次更新并对其检查 P3-TRK-36 的不变量 |
| `flush()` | 等待一个宏任务，让挂起的 promise 链执行完 |

测试总是提供全部依赖，`startCameraAR` 只在某个依赖缺失时才解析它的默认实现（OQ-02）。

### 2.7 PDF 解析器（`tests/app/helpers/pdf.ts`，P4）

- 读取文件头、`startxref`、经典交叉引用表和 trailer（遇到交叉引用流直接失败）；用一个小型词法器解析间接对象（数字、名字、带转义的字面字符串、十六进制字符串、数组、字典、引用、流）；解码未压缩或 FlateDecode（`node:zlib`）的流。
- 解释页面内容流：`q` `Q` `cm`、路径 `m l c v y h re`、绘制 `f F f* S s B B* b b* n`、颜色 `g G rg RG k K cs CS sc scn`、文字 `BT ET Tf Tm Td TD T* Tj TJ ' "`。输出带填充色的填充多边形、描边线段，以及文字片段（字体资源、有效字号、页面坐标中的起点），并按 WinAnsi 解码字节（0xB7 → ·，0xD7 → ×）。

### 2.8 容差、种子与确定性

- 断言阈值就是契约中的数字，原样使用：RMS 0.25 px、最大 0.6 px；1e−6 rad 和 1e−6 · ‖t‖；OQ-18 的 PnP 界限；1 % 和 10 %；输入标准差的 0.5 倍；6 帧内 0.5 px；正交性 1e−9。测试从不放宽它们。
- 闭式结果（内参、矩阵、相机位置、标定板坐标）用 1e−12 的相对容差。经过求解器的结果用契约本身的容差，或 1e−9。
- 统计性条款在写成测试之前已离线验证过（本计划 §10.1）；PnP 的旋转界限据此做了修改（OQ-18）。
- 种子在实现出现之前（Red 阶段）就写定，不为了让某次运行通过而更换；更换种子需要在本计划里注明。
- 不存黄金图像或输出快照：真值都是解析计算的，不同 Node 版本之间最后一位的差异至多改变一次 8 位取整，有界的断言能吸收。确定性用例在同一进程内比较两次运行。
- 只有 P1-PERF 用真实时钟，取中位数、先预热、界限放宽 3 倍（OQ-05）。其他用例都用手动时钟和手动调度器。
- 每个用例自己创建流水线、滤波器、tracker 和替身；用到它们的用例结束后执行 `vi.restoreAllMocks()` 和 `vi.unstubAllGlobals()`。耗时的 P1 用例把超时设为 120 s。

### 2.9 辅助工具自检

| 编号 | 检查 | 预期 |
| :--- | :--- | :--- |
| H-01 | 随机数 | 相同种子 → 相同的 1,000 个值；不同种子不同；`next()` 在 [0, 1) 内；10⁵ 次高斯采样均值误差 ≤ 0.01、标准差误差 ≤ 1 % |
| H-02 | 像素中心约定 | 10 px 格子、格边恰在像素边界上的标定板渲染后没有混合像素：只出现 40、128、200，第一行格子的第 10–19 列像素是暗的 |
| H-03 | 超采样偏差 | 37 个亚像素偏移处的竖直和水平格边：跨边归一化灰度之和给出的边位置误差 ≤ 1/32 px（另加 8 位取整的 0.004） |
| H-04 | 真值 | 20 个随机相机放置下，`physical` 与标定板模型的 K(R[X Y 0]ᵀ + t) 一致，误差 ≤ 1e−9 px |
| H-05 | 规范顺序 | 50 个标称场景中，truth(9, 6) 等于 `physical` 顺序，并满足 O2 和 O3（向外格子的对比 > 40）；6 个场景中，truth(6, 9) 是转置顺序 (j′, 5 − i′)，并满足 O2 和 O3 |
| H-06 | 标称条件核验 | 50 个采样场景都是标称的；8 个故意越界的场景（最短格边 11 px、倾角 61°、白边 0.2、对比度 79、模糊 1.1、噪声 4.5、增益 ±0.3、标定板部分出界）恰好只被标出它自己的原因；60 个压力场景都不是标称的 |
| H-07 | 模糊 | 卷积核之和为 1；常数图像不变；冲激响应标准差与 σ 相差 ≤ 1 %（σ 取 1 和 2） |
| H-08 | 噪声 | 640×360 上实测 σ 误差 ≤ 3 %、均值误差 ≤ 0.05；相同种子 → 相同图像，换种子则不同 |
| H-09 | 摄像头替身（P3） | `postMessage` 之后 buffer 已被分离；`respond` 交付的是新的 buffer 对象；调度器只运行挂起的回调并遵守取消 |
| H-10 | PDF 解析器（P4） | 能解析测试里手写的最小 PDF 1.4，并拒绝一个交叉引用偏移写错的副本 |
| H-11 | 场景目录 | P1 目录中每组场景数量符合预期，每个场景都通过它的检查（只凭几何信息） |

## 3. P1 检测器

### 3.1 `board.ts`（§5.1）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-BRD-01 | §5.1 `BOARD` | 读取 `BOARD` | squaresX 10、squaresY 7、cornersX 9、cornersY 6、squareSize 0.24、squareMeters 0.025 |
| P1-BRD-02 | §5.1 `boardCorners` | 调用一次 | 长度 108 的 `Float64Array` |
| P1-BRD-03 | §5.1 角点 k = j · 9 + i | 全部 54 个角点 | [2k, 2k+1] = ((i + 1 − 5) · 0.24, (j + 1 − 3.5) · 0.24)，误差 ≤ 1e−12 |
| P1-BRD-04 | §5.1 特征点 | 角点 0、8、45、53；质心 | (−0.96, −0.6)、(0.96, −0.6)、(−0.96, 0.6)、(0.96, 0.6)；质心 (0, 0)，误差 ≤ 1e−12 |
| P1-BRD-05 | §5.1"返回新数组" | 调用两次；改写第一次的结果 | 对象和 buffer 都不同；第二次结果不受影响 |
| P1-BRD-06 | §5.1 布局规则 | 与辅助标定板模型比较 | 角点 (i, j) 是格子 (j, i)、(j, i+1)、(j+1, i)、(j+1, i+1) 的公共顶点；角点 0 斜外侧的格子 (0, 0) 是暗格 |
| P1-BRD-07 | §5.1 `readonly`（OQ-07） | `Object.isFrozen(BOARD)` | true |

§5.1 最后一条（heroScene 的 `COLS`、`ROWS`、`SQUARE` 取自 `BOARD`）是 P3 的改动，由 P3-ARCH-01 检查。

### 3.2 `rgbaToGray`（§5.2）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-GRY-01 | BT.601，误差 ≤ 1 | 每个通道从 0 扫到 255，另两个通道分别取 {0, 255}；16 级网格（17 的倍数，4,096 种颜色）；65,536 个带种子的随机颜色，alpha 随机 | 每个值与 round(0.299 R + 0.587 G + 0.114 B) 相差 ≤ 1 |
| P1-GRY-02 | BT.601 特征值 | 黑、白、纯红、纯绿、纯蓝 | 0–1、254–255、75–77、149–151、28–30（能发现通道顺序错误） |
| P1-GRY-03 | 忽略 alpha | 1,000 个随机颜色，alpha 取 0、1、128、随机值和 255 | 输出相同 |
| P1-GRY-04 | 布局 | 6 种不同颜色的 3×2 图像 | data[v · w + u] 对应像素 (u, v)；宽高原样返回；data.length = w · h；data 是 `Uint8Array` 或 `Uint8ClampedArray` |
| P1-GRY-05 | 传入 `out` | `out` 预先填满 0xAA | 返回的 `data` 就是 `out` 本身；每个字节都被改写为 P1-GRY-01 的值 |
| P1-GRY-06 | 输入类型与视图 | `Uint8Array` 与 `Uint8ClampedArray` 输入；输入为周围都是白色像素、byteOffset 4 的视图；`out` 为更大 buffer 的子数组 | 数值相同；视图之外不读也不写 |
| P1-GRY-07 | 最小图像 | 1×1 | 正常工作 |
| P1-GRY-08 | `RangeError` | width 或 height 为 0、−1、2.5、NaN、Infinity；rgba.length 为 4wh − 1、4wh + 4、0；out.length 为 wh − 1、wh + 1 | `RangeError` |
| P1-GRY-09 | §8 纯函数 | 调用前复制 `rgba` 的字节；不传 `out` 调用两次 | `rgba` 不变；两次结果不共享数据。`out` 与 `rgba` 重叠属于不支持的用法，不测（OQ-08） |

### 3.3 `findChessboardCorners`（§5.2）

只有 (cornersX, cornersY) = (9, 6) 和 (6, 9) 享有精度、拒识和跟踪方面的保证；其他尺寸只作为拒识 (d) 的反例出现（OQ-09）。

#### 参数校验与结果布局

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-01 | 前置条件：图像 | width 或 height 为 0、−1、1.5、NaN；data.length 为 wh − 1 和 wh + 1 | `RangeError` |
| P1-DET-02 | 前置条件：点阵尺寸 | cornersX 或 cornersY 为 1、0、2.5、NaN；相等 (5, 5)；和为偶数 (4, 6)、(9, 7) | `RangeError` |
| P1-DET-03 | 前置条件：`previous` | 9×6 时长度为 107、109、0 | `RangeError`；长度 108、填满 NaN：不报错 |
| P1-DET-04 | 合法的边界输入 | 1×1 图像上的 (2, 3) 和 (3, 2)；1×1、3×3、16×16 图像上的 (9, 6)；S0 上 options 取 `undefined`、`{}`、`{ previous: null }`、`{ previous: undefined }` | 不抛错；过小的图像 → null；四种 options 写法结果相同 |
| P1-DET-05 | 结果布局 | 在 S0 上各请求 (9, 6) 和 (6, 9) 两次；以及 P1 中每个非 null 结果（共用断言） | 新建的长度为 2 · cornersX · cornersY 的 `Float32Array` |

#### 角点顺序 O1–O3

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-06 | 任意面内旋转下的 O1–O3 | 面内 0°、15°、…、345°（24 个场景），倾角 20°，最短格边 16 px，模糊 0.8，噪声 3 | 准确，因而满足 O1–O3 |
| P1-DET-07 | O2、O3 作为性质检查 | S0 以及 P1-DET-06 中 0°、90°、180°、270° 的场景；以及 P1 中每个准确的结果（共用断言） | cross(p(1,0) − p(0,0), p(0,1) − p(0,0)) > 0；角点 0 斜外侧的格子比它相邻的两个亮格都暗 |
| P1-DET-08 | 由 O3 确定角点 0 | 面内 180° 及 180° ± 5° | 准确：结果的角点 0 仍是标定板自身的角点 0，只是现在位于旋转前角点 53 所在的图像位置，即由颜色规则而不是图像位置决定角点 0（也覆盖黑白反色，见本计划 §2.3） |
| P1-DET-09 | O1 | 面内 90° 和 270°，横向和竖向图像 | 准确：i 沿有 9 个角点的那条边 |
| P1-DET-10 | 尺寸参数互换时的 O1 | 在 9×6 标定板上请求 (6, 9)，6 个场景 | 对 truth(6, 9) 准确：T(i′, j′) = physical (j′, 5 − i′)。这不算尺寸不符，因为 §7 第 5 步接受两种朝向 |

#### 标称条件下的精度

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-12 | 标称精度 | 40 个带种子的 640×360 `nominalScene` | 每个都准确 |
| P1-DET-13 | 格边 ≥ 12 px | 倾角 0°、30°、60° 下最短格边 12.25 px；模糊 1.0，噪声 4 | 准确 |
| P1-DET-14 | 倾角 ≤ 60° | 绕标定板 X 轴、Y 轴和对角线倾斜 60°，正负两个方向（6 个场景），最短格边 13 px，视场 45° 以便放得下 | 准确 |
| P1-DET-15 | 模糊 σ ≤ 1.0 | 最短格边 12 px 和 30 px 下模糊 1.0 | 准确 |
| P1-DET-16 | 噪声 σ ≤ 4 | 对比度 80（灰度 88/168）下噪声 4，5 个种子 | 准确 |
| P1-DET-17 | 对比度 ≥ 80 | 灰度 88/168、10/90、150/230，无增益 | 准确 |
| P1-DET-18 | 光照渐变 ±25 %（OQ-12） | 沿 0°、45°、90°、135° 方向增益 ±0.25，灰度 40/152，各处对比度 ≥ 80 | 准确 |
| P1-DET-19 | 白边 ≥ 0.25 格 | 白边恰好 0.25 格，在 1、2、4 条边上贴着图像边缘；白边之外是暗（20）背景或杂乱背景 | 准确 |
| P1-DET-20 | 白边之外的背景 | 白边之外的杂乱背景：矩形、类似文字的行、方格纸（5 个种子） | 准确 |
| P1-DET-21 | 所有极限同时出现 | 最短格边 12 px、倾角 60°、模糊 1.0、噪声 4、暗端对比度 80.25、增益 ±0.25、白边 0.25、杂乱背景（4 个种子） | 准确 |
| P1-DET-22 | 没有尺寸上限 | 标定板占满 640×360（45 px 格子）；1280×720（90 px 格子） | 准确 |
| P1-DET-23 | 图像形状 | 360×640、320×240、641×359、1280×720 | 准确 |
| P1-DET-24 | 像素中心约定 | 正对、面内 0°、24 px 格子，角点分别落在整数和半整数像素坐标上，无模糊无噪声 | 准确（单是半像素约定错误就会产生 0.71 px 的最大误差） |
| P1-DET-25 | 数据类型 | S0 分别以 `Uint8ClampedArray`、`Uint8Array` 和 byteOffset 7 的子数组视图传入 | 结果相同，且准确 |

#### 拒识

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-26 | (a) 没有标定板 | 均匀 0、128、255；σ 40 噪声（3 个种子）；线性和径向渐变；随机矩形（5 个种子）；类似文字的纹理（3 个种子）；方格纸；9×6 点阵；单个 2×2 棋盘 | 每个都是 null |
| P1-DET-27 | (b) 内角点在图外 | 最后一列角点超出右边缘 0.5 格；只有角点 53 在图外 5 px（标定板旋转 −35°）；角点 0 在左上方图外 5 px；标定板宽度是画面的 3 倍 | null |
| P1-DET-28 | (c) 角点被遮挡 | 半径 0.4 格的圆盘盖住角点 (4, 3)、(0, 0)、(8, 5) 或 (0, 3)，填充暗、亮、128 或纹理；一根高 0.67 格（半高 0.33 格）的长条盖住第 3 行全部角点 | 每个都是 null |
| P1-DET-29 | (c) 部分遮挡（OQ-13） | 半径 1 px 的圆盘盖在角点 (4, 3) 上；手指形状的遮挡物盖住外圈格子 (0, 4)，但没盖住任何内角点 | null 或准确 |
| P1-DET-30 | (d) 点阵更大 | 内角点为 10×7、9×7、10×6 的标定板，请求 (9, 6) | null |
| P1-DET-31 | (d) 点阵更小 | 内角点为 8×5、8×6、9×5 的标定板，请求 (9, 6) | null |
| P1-DET-32 | (d) 请求尺寸不符（OQ-09） | 在 9×6 标定板上请求 (8, 5)、(10, 7)、(9, 4)、(7, 6)、(2, 3)、(4, 3) | null |
| P1-DET-33 | (c) 角点被破坏（OQ-13） | 把格子 (3, 4) 和外圈格子 (0, 5) 的颜色翻转 | null |
| P1-DET-34 | §1 范围外（OQ-14） | 一幅图里有两块完整的 9×6 标定板 | null，或对其中一块准确 |
| P1-DET-35 | "`null` 永远好于错误结果"（OQ-10） | 60 个带种子的超出标称范围的场景，每类 6 个：模糊 1.5–2.5、噪声 8–16、倾角 65–80°、格子 7–11 px、对比度 30–79、增益 ±0.4–0.6、5 px 运动模糊、色调分离到 16 级、暗背景上没有白边、反光 | 每个都是 null 或编号正确 |

#### 靠近图像边缘

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-36 | 边缘豁免 | 外圈格子被图像边缘截断，最外侧的角点在边缘以内 0.6 或 2.8 px，其余条件标称（8 个场景，四条边都有） | null 或准确 |
| P1-DET-37 | 豁免与 (b) 的关系（OQ-11） | 最外侧的角点在边缘以外 0.6 或 2.8 px（8 个场景） | null 或准确（双侧豁免带） |
| P1-DET-38 | 介于标称和豁免带之间（OQ-11） | 外圈格子和白边被截断，每个内角点都在边缘以内 ≥ 4 px（4、6、9、12 px） | null 或准确 |

#### 跟踪提示

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-39 | 正确的提示 | `previous` = 检测器在 S0 上的结果；以及 `previous` = 真值 | 准确；结果不是 `previous` 那个数组 |
| P1-DET-40 | 移动 ≤ 0.25 格（OQ-15） | 每个角点移动 0.25 × 最短格边：8 个方向平移、旋转、放大缩小、改变倾角；`previous` = S0 上的结果 | 准确 |
| P1-DET-41 | 连续序列 | 30 帧标称画面，每帧移动 0.2 格，每次结果作为下一帧的提示 | 每帧都准确（不漂移） |
| P1-DET-42 | 过时的提示 | `previous` = 把 S0 平移 2 格、旋转 30°、放大 1.5 倍后的真值 | 在 S0 上准确 |
| P1-DET-43 | 顺序错乱的提示 | S0 的真值反转（k ↔ 53 − k）、i 翻转或 j 翻转 | 按规范顺序准确，绝不沿用提示的顺序 |
| P1-DET-44 | 错位一格的提示 | 点阵整体错开一列；错开一行 | 准确 |
| P1-DET-45 | 垃圾提示 | 全 0；全 NaN；+Infinity；−Infinity；带种子的图内随机值；1e9；所有角点重合在一点；负值；在 S0 和 5 个标称场景上 | 准确；不抛错 |
| P1-DET-46 | 提示 + (a) | `previous` = S0 的真值；图像取自 P1-DET-26 | null |
| P1-DET-47 | 提示 + (c) | `previous` = S0 上的结果；P1-DET-28 的遮挡帧 | null |
| P1-DET-48 | 提示 + (b) | `previous` = 每个场景自己的真值；P1-DET-27 的帧 | null |
| P1-DET-49 | 提示 + (d)，更大 | 内角点 10×7 的标定板；`previous` = 其中精确的 9×6 子点阵 | null |
| P1-DET-50 | 提示 + (d)，更小 | 内角点 8×5 的标定板；`previous` = 向外多外推一列一行得到的 9×6 点阵 | null |
| P1-DET-51 | 大幅移动 | 标定板自 `previous` 以来移动了 1 格 | 准确 |
| P1-DET-52 | 标称之外保证不变（OQ-10） | P1-DET-35 的场景，`previous` = 真值 | null 或编号正确 |

#### 确定性与不修改输入

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-DET-53 | 确定性 | 同一输入调用两次，带与不带相同的提示 | 结果相同 |
| P1-DET-54 | 没有隐藏状态 | S0、另一个场景（带与不带提示）、再次 S0 | 两次 S0 的结果相同 |
| P1-DET-55 | 不修改图像 | 对一次找到和一次返回 null 的调用，事先复制 `image.data` 的字节和宽高 | 不变 |
| P1-DET-56 | 不修改提示 | 复制 `previous` 的 buffer 字节，包括带特殊位模式的 NaN | 不变 |
| P1-DET-57 | 返回新数组（OQ-17） | 带提示且找到的调用；调用两次 | 结果不是 `previous`，与 `previous`、`image.data` 不共享 buffer；byteOffset 为 0，buffer 的 byteLength 为 432（恰好等长）；两次调用返回两个对象 |

### 3.4 性能冒烟测试（§5.2、§9）

放在默认测试集中，界限为目标的 3 倍（OQ-05）。每个用例先检查计时帧的结果，所以又快又错的实现过不了。

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-PERF-01 | 完整检测 ≤ 30 ms | S0（能找到）；预热 3 次，计时 15 次 | 中位数 ≤ 90 ms；记录中位数 |
| P1-PERF-02 | 有效提示下 ≤ 5 ms | `previous` = S0 上的结果；S0 移动 0.1 格（能找到） | 中位数 ≤ 15 ms |
| P1-PERF-03 | 没有标定板的帧（OQ-16） | 640×360 杂乱背景加 σ 12 噪声（返回 null） | 中位数 ≤ 90 ms |

手机上的指标（每秒 ≥ 20 次结果）手动检查（M3-15、M3-16）。

## 4. P2 位姿与 worker 流水线

### 4.1 `intrinsicsFromFov`（§5.3）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-INT-01 | 公式 | 640×360，60° | fx = fy = 554.2562584，cx 319.5，cy 179.5（1e−9） |
| P2-INT-02 | 公式 | 1280×720、90°；360×640、60°；1×1、60° | fx = 640；fx = 311.7691454，cx 179.5，cy 319.5；cx = cy = 0 |
| P2-INT-03 | `RangeError` | width 或 height 为 0、−1；hfovDeg 为 0、180、−1、181、NaN、Infinity | `RangeError` |
| P2-INT-04 | 非有限或非整数尺寸（OQ-22） | width 或 height 为 NaN、±Infinity；width 为 640.5 | NaN 和 ±Infinity 抛 `RangeError`；接受 640.5（fx = 320.25 / tan 30°） |

### 4.2 `solvePlanarPnP`（§5.3）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-PNP-01 | 前置条件 | 长度 108 对 106；长度 7；N = 3；空数组；任一数组含 NaN 或 ±Infinity；K 的 fx 为 0、fy 为 −1、fx 为 NaN、cx 为 Infinity | `RangeError` |
| P2-PNP-02 | `ArrayLike` 输入 | `number[]`、`Float64Array`、`Float32Array` | 都接受；数值相同的 `number[]` 和 `Float64Array` 得到相同位姿 |
| P2-PNP-03 | 精确投影（OQ-19） | 30 个带种子的位姿：标定板 ≥ 图宽 1/3，倾角 0–60°，任意面内旋转，居中和偏离中心都有；float64 图像坐标 | 旋转误差 ≤ 1e−6 rad，‖t − t_true‖ ≤ 1e−6 · ‖t_true‖；R 按行主序比较 |
| P2-PNP-04 | 精确投影，少量点 | N = 4（角点 0、8、45、53）；N = 10 个随机平面点 | 同样的界限 |
| P2-PNP-05 | 一般的 K | fx 500、fy 520、cx 300、cy 200，精确数据 | 同样的界限 |
| P2-PNP-07 | 后置条件 | P2 中返回的每个位姿（共用断言） | R 是 `Float64Array(9)`，max abs(RᵀR − I) ≤ 1e−9，abs(det R − 1) ≤ 1e−9；t 是 `Float64Array(3)` 且 t_z > 0；`rms` 有限且 ≥ 0 |
| P2-PNP-08 | `rms` 的定义 | 测试自己计算 sqrt((1/N) · Σ ‖imageXY_k − K(R [X Y 0]ᵀ + t)‖²)，对 N 个点取平均 | 与 `rms` 相对误差 ≤ 1e−9 |
| P2-PNP-09 | 加噪精度（OQ-18） | 54 个角点加 σ 0.3 px 噪声，真实 K，标定板 ≥ 图宽 1/3；倾角 35–60° 和 0–35° 各 20 次带种子的试验 | 倾角 35–60°：旋转 ≤ 0.5°；倾角 0–35°：旋转 ≤ 3°；两者平移都 ≤ ‖t_true‖ 的 1 % |
| P2-PNP-10 | 最小化像素误差 | 那 40 次加噪试验 | `rms` ≤ 真实位姿的 rms + 1e−9，并且 ≤ 辅助工具只用单应得到的位姿的 rms + 1e−9 |
| P2-PNP-11 | 局部极小（OQ-66） | 旋转绕各轴扰动 ±1e−4 rad，t 各分量扰动 ±1e−4 · ‖t‖ | `rms` 下降不超过相对 1e−9 |
| P2-PNP-12 | 退化 → null（OQ-20、OQ-61） | 所有物点共线；所有像点共线；所有像点重合；2 个点各重复 4 次；4 个点中有 3 点共线 | null |
| P2-PNP-13 | 标定板在相机后方（OQ-21、OQ-67） | 一块刚性标定板，其平面在两行或两列角点之间穿过相机的 z = 0 平面，因此一部分角点 Z > 0、另一部分 Z < 0（abs(Z) ≥ 0.1，像素坐标都是有限值），用针孔公式投影。三种情形：第 0–1 行在后方、板原点在前方；只有第 5 行在后方、原点在前方；第 3–8 列在后方、原点在后方。没有哪块完全位于相机前方的标定板能重现这些像素 | null |
| P2-PNP-14 | §8 纯函数 | 相同输入调用两次；事先复制输入的字节 | R、t、rms 逐位相同；输入不变 |
| P2-PNP-15 | 尺度不变 | 物点 × 7、t_true × 7，精确数据 | R 相同；t 为 7 倍，相对误差 ≤ 1e−6 |
| P2-PNP-16 | 标定板原点在相机后方（OQ-69） | 54 个角点沿 X 平移 6、沿 Y 平移 8、沿对角线平移 7，使最近的角点离其坐标原点也有至少 5 个板单位；分别以 30°、40°、50° 的倾角观察，每个角点都在相机前方（z ≥ 1.5），而该原点在相机后方（t_z 为 −1.0、−2.6、−2.4）；精确投影 | null；同样的像素配上角点自身以中心为原点的坐标，得到真实位姿，误差在 P2-PNP-03 的界限内 |

说明：P2-PNP-09…11 共用那 40 次试验，设置同本计划 §10.1：640×360，hfov 60°，标定板居中且方格恰好占图宽 1/3，倾斜轴和面内旋转随机。P2-PNP-11 把 R 绕经过板原点的各个相机坐标轴旋转（R ← Rot(±10⁻⁴) · R，t 不变），t 则一次只动一个分量。P2-PNP-13 替换了最初的构造（有效投影的点反射 −P）：透视除法会消去符号（u = fx · (−X)/(−Z) + cx），所以那些像素就是该有效投影自己的像素，相机前方的标定板就能解释它们。

### 4.3 `estimateFocal`（§5.3）

本节中倾角指标定板法线与光轴的夹角（OQ-23）。加噪试验取 OQ-24 范围的边界：640×360，标定板居中且方格恰好占图宽 40 %，σ 0.3 px。P2-FOC-04…06 的精确数据试验中，标定板占图宽 40 %–90 %，中心在主点周围、图像尺寸的 ±15 % 以内。P2-FOC-04…06 和 P2-FOC-10 的真实 hfov 在 40–100°（D1 的限幅范围，OQ-62）内抽取；P2-FOC-03 保持 hfov 60°，即本计划 §10.1 的设置。

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-FOC-01 | 前置条件（OQ-22） | P2-PNP-01 中的数组情形；width 或 height 为 0、−1、NaN、±Infinity | `RangeError` |
| P2-FOC-02 | 精确数据，倾角 ≥ 30° | 绕标定板 X、Y 轴和对角线倾斜 30°、45°、60°；真实 hfov 40°、60°、90°、100°；标定板居中 | 误差 ≤ 1 % |
| P2-FOC-03 | 加噪，倾角 45° | σ 0.3 px，标定板 ≥ 图宽 40 %，20 次带种子的试验 | 每次误差 ≤ 10 % |
| P2-FOC-04 | 倾角 < 10° → null | 倾角 0°、5°、9.5°，精确和加噪（各 20 次） | null |
| P2-FOC-05 | 倾角 10–25° | 10°、15°、20°、24° | null 或有限正数 |
| P2-FOC-06 | 倾角 ≥ 25° → 有值（OQ-24） | 倾角 25°、30°、45°、60°；精确数据和 σ 0.3 px 数据（各 20 次）；标定板 ≥ 图宽 40 % | 非 null |
| P2-FOC-07 | 偏离中心的正对标定板（OQ-23） | R = I，标定板靠近图像一角（视线夹角约 25°，相对光轴的倾角为 0°） | null |
| P2-FOC-08 | 退化点集（OQ-25） | 共线；重复点 | null；不抛错 |
| P2-FOC-09 | 输出值域 | 全部 P2-FOC 输入，加 50 组带种子的随机对应点 | null 或有限的正数 |
| P2-FOC-10 | 不变性，§8 | 物点 × 7；同一输入调用两次；复制输入字节 | 估计值相对误差 ≤ 1e−9；两次输出相同；输入不变 |

### 4.4 `viewMatrix`、`projectionMatrix`、`cameraPosition`（§5.3、§6）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-VM-01 | `viewMatrix` 公式 | 20 个随机位姿 × 10 个随机场景点 | V · [p, 1]（列主序，V[4c + r]）= [F (R · B · p + t), 1]，误差 ≤ 1e−12 |
| P2-VM-02 | 形状 | 任意位姿 | `Float64Array(16)`；(V[3], V[7], V[11], V[15]) = (0, 0, 0, 1)；每次返回新数组；不修改 pose |
| P2-VM-03 | `THREE.Matrix4` 元素顺序 | `new THREE.Matrix4().fromArray(V)`，再用 `Vector3.applyMatrix4` | 结果与公式一致 |
| P2-VM-04 | 已知位姿 | R = I，t = (0, 0, 5)；场景点 (0,0,0)、(0,1,0)、(1,0,0)、(0,0,1) | (0, 0, −5)、(0, 0, −4)、(1, 0, −5)、(0, −1, −5) |
| P2-PM-01 | NDC 公式 | fx 500、fy 520、cx 300、cy 200 的 K 和默认 K；图像 640×360；视口 1280×720、390×844、1920×800、320×180；Z ∈ [near, far] 的随机点 | P · [X, −Y, −Z, 1] 做透视除法后得到 §5.3 的 x_ndc 和 y_ndc，误差 ≤ 1e−9 |
| P2-PM-02 | cover 适配（§6），独立推导 | 同上 | 等于 u = fx · X/Z + cx → 视口 x = (W − s · w)/2 + s · (u + 0.5) → x_ndc = 2x/W − 1（y 同理但翻转），s = max(W/w, H/h)，误差 ≤ 1e−9 |
| P2-PM-03 | cover 的边界 | 宽视口 1920×800（s = W/w）；高视口 390×844（s = H/h） | 宽：u = −0.5 → x_ndc = −1，u = w − 0.5 → +1。高：v = −0.5 → y_ndc = +1，v = h − 0.5 → −1 |
| P2-PM-04 | 深度 | Z = near、Z = far 及其间的点 | z_ndc 分别为 −1 和 +1，误差 ≤ 1e−9；随 Z 递增 |
| P2-PM-05 | 能被 WebGL 使用（OQ-26） | Z > 0 的点 | 裁剪空间 w = k · Z 且 k > 0；det P ≠ 0 |
| P2-PM-06 | `RangeError`（OQ-22、OQ-64、OQ-70） | 图像或视口宽高为 0、−1、NaN、±Infinity；near 为 0、−1；near = far；near > far；near 或 far 为 NaN；far = Infinity；K 的 fx 为 0 或 −1、fy 为 0 或 −1、fx 为 NaN、fy 为 Infinity、cx 为 NaN 或 Infinity、cy 为 −Infinity，其余参数合法 | `RangeError` |
| P2-PM-07 | 形状，在 three.js 中使用 | 任意合法输入 | `Float64Array(16)`，每次新建；经 `Matrix4.fromArray` 和 `Vector3.applyMatrix4`（会除以 w）得到同样的 NDC |
| P2-CP-01 | `cameraPosition` 公式 | 20 个随机位姿 | B⁻¹ · (−Rᵀ t)，误差 ≤ 1e−12；每次返回新的 `Float64Array(3)` |
| P2-CP-02 | 与 `viewMatrix` 一致 | 同上 | V · [c, 1] = (0, 0, 0, 1)，误差 ≤ 1e−9 |
| P2-CP-03 | 已知位姿 | R = I，t = (0, 0, 5) | (0, 5, 0) |
| P2-CHN-01 | 角点标记画在检测到的角点上 | 10 个随机位姿；54 个角点对应的场景点 (X, 0, Y) | 经 P · V 后落在 (X, Y, 0) 的 K 投影按 cover 映射后的位置，NDC 误差 ≤ 1e−9 |
| P2-CHN-02 | 场景的"上"（§6） | 从正面看标定板的位姿 | 场景点 (0, 0.5, 0) 比 (0, 0, 0) 离 three.js 相机更近 |

`viewMatrix` 和 `cameraPosition` 不校验参数（OQ-22），所以没有它们的报错用例。

### 4.5 `createCornerFilter`（§5.4）

`time` 的单位是毫秒，与 `FrameInput.time` 相同（OQ-01）；帧间隔 1000/30 ms。只测行为条款；§7 中的 One Euro 写法只是实现指引（OQ-27）。

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-CF-01 | 首次调用 | 新滤波器，任意数组 | 返回副本：数值相同，对象和 buffer 都是新的 |
| P2-CF-02 | `reset()` 之后 | 已收敛的滤波器，`reset()`，再给一个相距很远的输入 | 输出与输入完全相同 |
| P2-CF-03 | 长度变化 | 108 → 10 → 108 个值 | 每次变化时返回副本；之后从新的起点开始平滑 |
| P2-CF-04 | 时间没有后移 | 同一时间调用两次；时间倒退 | 返回副本，并从它重新开始 |
| P2-CF-05 | 恒定输入 | 100 帧相同输入 | 每次输出都等于输入 |
| P2-CF-06 | 各坐标独立 | 坐标 a 静止、坐标 b 以 300 px/s 移动，放在同一数组里滤波 | 与两个各管一个坐标的滤波器结果一致，误差 ≤ 1e−12 |
| P2-CF-07 | One Euro 是一阶低通 | 500 帧随机输入 | 每次输出都介于上一次输出和当前输入之间；阶跃时不过冲 |
| P2-CF-08 | 抖动（OQ-28） | 108 个静止坐标加 σ 0.3 px 带种子抖动，30 fps，300 帧 | 每个坐标第 11–300 帧输出的标准差 ≤ 其输入标准差的 0.5 倍 |
| P2-CF-09 | ≥ 12 px 的阶跃（OQ-29） | 收敛后在 x 方向 +12 px、y 方向 −12 px、对角线方向 12 px 阶跃；无噪声 | 从新位置的第 6 个输出起，每个角点都在新位置 0.5 px 以内（欧氏距离） |
| P2-CF-10 | 更大的阶跃 | 50 px 和 200 px | 同样的界限 |
| P2-CF-11 | 选项生效 | minCutoff 1e6；minCutoff 0.01 且 beta 0 | ‖out − in‖ ≤ 1e−3 px；12 px 阶跃 10 帧内移动 < 1 px |
| P2-CF-12 | 返回新数组，不改输入 | 任意 | 每次返回不同的对象；输入字节不变 |

### 4.6 `createFocalTracker`（§5.4）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-FT-01 | `minSamples` 之前用默认值 | hfovDeg 60：focal(640)、focal(360)；hfovDeg 75：focal(640) | 554.2562584；311.7691454；417.0321 |
| P2-FT-02 | `minSamples` 为 5 | 加入 500、510、490、520 后查询；再加入 480 后查询 | 默认值；然后 500 |
| P2-FT-03 | 忽略 `add(null)` | 估计值之间夹着 null | null 既不计入 `minSamples`，也不占窗口位置 |
| P2-FT-04 | `window` 为 15 | 5 × 1000，再 15 × 500；再加一个 1000 | 500；仍为 500 |
| P2-FT-05 | 中位数 | 7 个和 15 个未排序的估计值 | 中间值 |
| P2-FT-06 | 偶数个（OQ-30） | 100、200、300、400、500、600；以及 8 个估计值 | 取中间两个值的平均：350；第 4、5 个值的平均 |
| P2-FT-07 | 按查询宽度钳位 | 宽 640 下估计值都是 1e6；估计值都是 1；中位数 500 在宽 320 下查询 | 879.1928（40°）；268.5119（100°）；439.5964（宽 320 下的 40°） |
| P2-FT-08 | 选项 | window 3、minSamples 1、minFovDeg 50、maxFovDeg 90 | 行为与选项一致 |
| P2-FT-09 | `reset()` | 学习之后 `reset()`，再加 4 个新估计值 | 第 5 个之前都是默认值 |
| P2-FT-10 | 默认值不钳位 | hfovDeg 30 | `minSamples` 之前为 (w/2)/tan(15°)，宽 640 时为 1194.2563 |
| P2-FT-11 | 非有限估计值（OQ-31） | 有效估计值之间夹着 NaN、±Infinity、0、−1 | 与 null 一样忽略 |

### 4.7 `createPipeline`（§5.4 第 1–6 步）

除非另有说明，帧为 320×180（标称的 12 px 格子放得下），RGBA 由灰度渲染结果按 R = G = B 生成，间隔 1000/30 ms。"原始"角点指被 spy 的检测调用返回的角点。

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-PIP-01 | 第 3 步 | 空白帧 | found false，corners null，pose null，intrinsics { fx = fy = 277.1281292, cx 159.5, cy 89.5 }，`ms` 有限且 ≥ 0 |
| P2-PIP-02 | 第 4 步 | 标称的标定板帧 | found true；corners 为 `Float32Array(108)`；pose 非 null；intrinsics 满足 fx = fy、cx = (w − 1)/2、cy = (h − 1)/2 |
| P2-PIP-03 | 第 4 步的组合 | 同一帧 | `pose` 与测试重新计算的 `solvePlanarPnP(boardCorners(), corners, intrinsics)` 逐位相同 |
| P2-PIP-04 | 第 2 步（spy） | 5 帧移动的画面 | `findChessboardCorners` 的参数是帧尺寸的 `GrayImage`（数据等于 `rgbaToGray(rgba)`）以及 9、6；`previous` 先是 null 或缺省，之后是上一次调用的返回值（原始角点），且与平滑后的输出不同 |
| P2-PIP-05 | 第 2 步，丢弃提示（spy） | 未找到的帧之后；`reset()` 之后；尺寸变化之后 | `previous` 为 null 或缺省 |
| P2-PIP-06 | 第 2、4 步（OQ-33） | 检测成功但 `solvePlanarPnP` 被 mock 成 null；看下一帧 | 下一次调用的 `previous` 是该帧的原始角点 |
| P2-PIP-07 | 第 4 步平滑（spy） | 10 帧移动画面，平滑开；以及关 | 开：corners 与一个单独的 `createCornerFilter()` 喂入原始角点和帧时间得到的结果完全相同。关：等于原始角点 |
| P2-PIP-08 | 第 3 步重置滤波器 | 找到、找到、未找到、找到 | 第 4 帧输出的 corners 等于它的原始角点 |
| P2-PIP-09 | 第 4 步，`autoFocal` 为 false（spy） | 10 帧，hfovDeg 60 和 75 | 从不调用 `estimateFocal`；每帧 fx = (w/2)/tan(hfov/2) |
| P2-PIP-10 | 第 4 步，`autoFocal` 为 true（mock） | `estimateFocal` 按脚本返回 400、null、410、405、395、402、… | 每个找到的帧调用一次，参数为 (boardCorners(), 原始角点, width, height)；每帧的 fx 符合 §5.4 的跟踪器规则，且该帧自己的估计值在构造 K 之前加入 |
| P2-PIP-11 | 第 4 步 + 焦距跟踪器，端到端 | 640×360，真实 hfov 50°，倾角 40–50°，12 帧；再用真实 hfov 30° | 第 12 帧后 abs(fx/f_true − 1) ≤ 10 %；30° 时 fx = 879.1928（宽 640 下的 40° 钳位），误差 ≤ 1e−9 |
| P2-PIP-12 | 第 5 步，转移 | 每次调用后用 `structuredClone(…, { transfer })` 分离 corners、`pose.R`、`pose.t` 的 buffer；平滑开和关 | 后续调用不抛错，结果与不分离的运行一致（`ms` 除外） |
| P2-PIP-13 | 第 5 步，确定性 | 两条新流水线，同样 20 帧，含找到、丢失、尺寸变化和 `reset()` | 输出相同（`ms` 除外） |
| P2-PIP-14 | 第 1 步 | A：先 8 帧 320×180，再 6 帧 180×320。B：新流水线只处理这 6 帧 | 输出相同；内参回到 180×320 的默认值 |
| P2-PIP-15 | 第 6 步 | 序列中途 `reset()` | 之后的输出与新流水线相同 |
| P2-PIP-16 | 第 4 步，PnP 返回 null（mock） | `solvePlanarPnP` 返回 null | found false，corners null，pose null，intrinsics = 跟踪器当前值；下一个找到的帧 corners 等于其原始角点 |
| P2-PIP-17 | 第 2 步，灰度转换 | 只看红色通道是反色标定板的 RGBA（灰度 80/180） | 找到；角点 0 与灰度真值的角点 0 相距 ≤ 1 px |
| P2-PIP-18 | 合理性检查，非契约界限 | 640×360，真实 hfov 60°，`autoFocal` false，倾角 30–50°，标定板 ≥ 图宽 50 % | 旋转误差 ≤ 2°，平移误差 ≤ 3 % |
| P2-PIP-19 | 默认值 | `createPipeline()` 与 `createPipeline({ hfovDeg: 60, autoFocal: true, smoothing: true })`，15 帧 | 输出相同（`ms` 除外） |
| P2-PIP-20 | §8 自包含 | 复制 `frame.rgba` 的字节 | `process` 之后不变 |
| P2-PIP-21 | 格式错误的帧（OQ-35） | 在有效帧之间夹一个长度为 4 · w · h − 4 的 `rgba` | `process` 抛 `RangeError`；之后各帧的输出与没有这一帧的运行相同 |
| P2-PIP-22 | 第 3 步的内参（OQ-34） | 已有 ≥ 5 个脚本估计值之后的未找到帧 | fx = fy = 跟踪器的焦距，cx = (w − 1)/2，cy = (h − 1)/2 |

### 4.8 `handleWorkerMessage` 与 `tracker.worker.ts`（§5.4）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-WRK-01 | `frame` → `result`（假流水线） | `process` 返回脚本化的找到结果 | type 为 "result"，id 相同；found、corners、intrinsics、ms 来自输出；pose 为 { R: number[9], t: number[3], rms }（`Array.isArray` 为真，数值相同）；`buffer === message.buffer` |
| P2-WRK-02 | "把 buffer 包成 RGBA" | spy `process` | width、height、time 原样传入；rgba 是覆盖整个 buffer 的 `Uint8ClampedArray`（`rgba.buffer === buffer`，byteOffset 0，length = byteLength） |
| P2-WRK-03 | 转移列表 | 找到和未找到的输出 | 恰为 { buffer, corners.buffer }，无重复；corners 为 null 时为 [buffer] |
| P2-WRK-04 | 实际可转移 | `structuredClone(reply, { transfer })` | 成功；两个 buffer 都被分离；克隆保留数据 |
| P2-WRK-05 | `reset` | `{ type: "reset" }` | `pipeline.reset()` 调用一次；返回 null |
| P2-WRK-06 | 其他类型 | `{ type: "bogus" }` | null；不调用 `process` 和 `reset` |
| P2-WRK-07 | `process` 抛异常 | `process` 抛出 `Error("boom")` | `{ type: "error", id, message: "boom" }`；transfer 为 []；不抛错 |
| P2-WRK-08 | 特殊的异常和消息（OQ-36） | `process` 抛出字符串或普通对象；消息为 `null` 或 `undefined` | message = `String(value)`；`null` 和 `undefined` 消息返回 null 且不抛错 |
| P2-WRK-09 | 真实流水线 | 标定板帧；空白帧 | 标定板帧：found true，pose 非 null，corners 长度 108。空白帧：pose null，corners null，transfer 为 [buffer] |
| P2-WRK-10 | 真实流水线，buffer 有误 | buffer 少 4 字节 | id 相同的 `error` 回复；transfer 为 [] |
| P2-WKE-01 | worker 入口的连接 | `vi.stubGlobal("self", fake)`，导入模块，派发一个 frame 事件 | 设置了 `self.onmessage`；`self.postMessage` 被调用一次，参数为 `result` 回复和包含该 buffer 的转移列表（`postMessage(m, transfer)` 与 `postMessage(m, { transfer })` 两种写法都接受） |
| P2-WKE-02 | null 回复不发送 | `reset` 和未知类型的消息 | 不调用 `postMessage` |
| P2-WKE-03 | 错误路径 | 格式错误的帧 | `postMessage` 发出 `error` 回复，转移列表为空 |

### 4.9 选项校验

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-OPT-01 | §5.4 选项（OQ-32） | `createPipeline({ hfovDeg: 0 })`、`createCornerFilter({ minCutoff: 0 })`、`createFocalTracker({ hfovDeg: 60, window: 0 })`、`{ minSamples: 0 }`、minFovDeg ≥ maxFovDeg | 创建时抛 `RangeError` |

### 4.10 静态依赖检查（OQ-03）

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P2-ARCH-01 | §4 依赖方向 | 扫描 `src/ar` 中的 import 语句 | board：无依赖；chessboard → board；pose：只有类型导入；pipeline → chessboard、pose、board；tracker.worker → pipeline；tracker 只通过 `import type` 依赖 pipeline 和 pose |
| P2-ARCH-02 | §4 不依赖 DOM，worker 里没有 three.js | 同上 | 运行时不导入 `three`、`react` 或 `src/components`；除 `tracker.ts` 的默认依赖外不出现 `window`、`document` |

## 5. P3 摄像头 AR 浮层

### 5.1 `startCameraAR`（§5.5）

所有用例都使用本计划 §2.6 的替身，并提供全部依赖。

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P3-TRK-01 | B1（OQ-37） | 调用 `startCameraAR` | 返回之前恰好一次更新：status "starting"，error null，pose null，intrinsics null，frame null，fps 0 |
| P3-TRK-02 | B2 非安全上下文 | `isSecureContext` 为 false | 更新序列 [starting, error/insecure]；从不调用 `getUserMedia`；清空所有替身的待办后不再有更新 |
| P3-TRK-03 | B2 不支持 | `mediaDevices` 为 undefined；`mediaDevices` 为不含 `getUserMedia` 的 {} | error/unsupported |
| P3-TRK-04 | B2 优先级 | 同时非安全且没有 `mediaDevices` | error/insecure（非安全的规则是无条件的） |
| P3-TRK-05 | B3 | 默认选项 | `getUserMedia` 调用一次，参数严格等于 { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } }（`toStrictEqual`） |
| P3-TRK-06 | B3 | facingMode 为 "user" | `{ ideal: "user" }`，其余不变 |
| P3-TRK-07 | B4 映射 | 用 `DOMException` 和普通 `{ name }` 对象拒绝 | NotAllowedError、SecurityError → denied；NotFoundError、OverconstrainedError → no-camera；AbortError、NotReadableError、TypeError、`{}`、字符串、`undefined` → failed |
| P3-TRK-08 | B4 终止 | 每种错误之后：worker 回复、tick、`play()` 或 `getUserMedia` 完成 | 不再有更新；创建过的 worker 都已终止；拿到的 track 都已停止；没有挂起的帧回调 |
| P3-TRK-09 | B4 `play()`（OQ-41） | `play()` 以 `Error` 拒绝；以 NotAllowedError 的 `DOMException` 拒绝 | 两种都是 failed；track 已停止；worker 已终止 |
| P3-TRK-10 | B4 worker 的 `error` 回复 | 回复 `{ type: "error" }` | failed，终止，资源已释放 |
| P3-TRK-11 | B4 `onerror` | `crash(event)` | failed，终止，资源已释放 |
| P3-TRK-12 | B4 依赖抛出的异常（OQ-42） | `createWorker`、`captureFrame` 或 `requestFrame` 抛错 | error/failed，终止，资源已释放 |
| P3-TRK-13 | B5 | 先让 `getUserMedia` 完成，再让 `play()` 完成 | 调用 `play()` 时 `srcObject === stream`；`play()` 完成之前没有 searching 更新，也没有 `requestFrame`；完成之后：searching（error null，pose null） |
| P3-TRK-14 | B6 同时只有一帧在处理 | 第一帧发出后 tick 10 次；收到回复后再 tick；跑 50 帧 | 有帧在处理时不发新帧；每次回复之后最迟在下一次 tick 发出新帧；任何时刻发出数 ≤ 回复数 + 1 |
| P3-TRK-15 | B6 消息（OQ-49） | 任意一帧 | { type "frame", id, width, height, buffer, time }，buffer.byteLength = 4 · w · h；转移列表包含该 buffer；time = 采集时的 `deps.now()` |
| P3-TRK-16 | B6 采集 | 任意一帧 | `captureFrame(video, w, h, out)`，`out` 是覆盖待发 buffer 的 `Uint8ClampedArray(4 · w · h)`；发出的字节就是 `captureFrame` 写入的字节 |
| P3-TRK-17 | B6 分析尺寸（OQ-48） | 视频 1280×720、720×1280、1920×1080、640×480、320×240、1366×768、1000×563、720×720、2000×1；1280×720 下 analysisLongSide 480 | 640×360、360×640、640×360、640×480、320×240、640×360、640×360、640×640、640×1（`Math.round`，每边 ≥ 1）；480×270 |
| P3-TRK-18 | B6 尺寸为 0 | videoWidth 或 videoHeight 为 0 持续 3 次 tick，然后变为 1280×720 | 为 0 时不采集也不发送；帧回调继续请求；两者都非 0 后开始发送 |
| P3-TRK-19 | B6 复用 buffer | 尺寸不变；随后视频尺寸变化 | 第 n + 1 帧用第 n 次回复带回的 buffer 发送（同一对象）；尺寸变化后改用新尺寸的 buffer |
| P3-TRK-20 | B6/B7 帧 id（OQ-45） | 发出帧的 id；id 对不上的回复 | id 严格递增；对不上的回复不产生更新 |
| P3-TRK-21 | B7 每次回复一次更新 | N 次回复 | searching 之后恰好 N 次更新；只有 tick 不产生更新 |
| P3-TRK-22 | B7 找到 | 找到的回复；以及处理期间视频尺寸变了的情况 | tracking，pose 与回复一致（R、t 数值相同，按 `Pose` 类型为 `Float64Array`；rms 相同），intrinsics 相同；frame = 那一帧发出时的尺寸 |
| P3-TRK-23 | B7 保持（D3） | holdMs 500：t0 找到，t0 + 200 未找到，t0 + 600 未找到；holdMs 200：+150 和 +250 未找到；holdMs 0：+1 未找到 | 保持上次位姿的 tracking；pose 为 null 的 searching；先 tracking 后 searching；searching |
| P3-TRK-24 | B7 保持的计时 | 第 1 帧在 0 采集、100 收到找到的回复；第 2 帧在 130 采集、650 收到未找到的回复 | searching：保持时间按回复到达时刻（`onmessage` 中的 `deps.now()`）计算，而不是采集时刻 |
| P3-TRK-25 | B7 重新捕获 | searching 之后收到找到的回复，300 ms 后又未找到 | tracking，然后保持新位姿的 tracking |
| P3-TRK-26 | B7 边界与保持期的字段（OQ-38） | 距上次找到恰好 holdMs 时未找到；保持期更新中的字段 | 仍是 tracking（≤ holdMs 算以内）；保持期的更新带上次找到的回复的内参和帧尺寸 |
| P3-TRK-27 | B8 | 每 34 ms 一次回复，持续 2 s；第一次回复；间隔 1.5 s 后的回复；找到与未找到混合 | 稳定时 fps 为 30（29 × 34 = 986 < 1000 < 1020，没有回复正好落在边界上）；1；1；两种回复都计数 |
| P3-TRK-28 | B8 边界（OQ-39） | 恰好 1000 ms 之前的回复 | 不计入（now − t < 1000 ms 的回复计入，包括当前这次） |
| P3-TRK-29 | B9 跟踪中 stop | 2 个 track 的流；有挂起的帧回调 | 每个 track 都停止；worker 终止；不留挂起的帧回调；`stop()` 本身不发更新，之后也没有（经保留的处理函数到来的迟到回复、tick、时钟推进） |
| P3-TRK-30 | B9 幂等（OQ-44） | 第二次 `stop()` | 不抛错，没有更新；`terminate()` 和每个 track 的 `stop()` 总共恰好各调用一次 |
| P3-TRK-31 | B9 在 `getUserMedia` 完成之前（OQ-43） | `stop()`，然后用 2 个 track 的流完成它，再 `flush()` | 没有更新；迟到的流的所有 track 都被停止；不设置 `srcObject`；不调用 `play()` |
| P3-TRK-32 | B9 在 `getUserMedia` 失败之前 | `stop()`，然后让它失败 | 没有 error 更新 |
| P3-TRK-33 | B9 `play()` 未完成时 | `stop()`，然后让 `play()` 完成 | 没有 searching 更新；不请求帧；track 已停止 |
| P3-TRK-34 | B9 有帧在处理时 | `stop()`，然后经保留的处理函数送来迟到的回复 | worker 已终止；没有更新；不再发送帧 |
| P3-TRK-35 | B9 出错之后 | error/denied 之后 `stop()` | 不抛错，没有更新 |
| P3-TRK-36 | `TrackingUpdate` 不变量 | P3 中记录的每次更新（共用断言） | error 非 null ⇔ status 为 "error"；pose 非 null ⇔ status 为 "tracking"；fps 为 ≥ 0 的整数 |
| P3-TRK-37 | `TrackingUpdate` 字段（OQ-37） | starting、searching、error 更新中的 intrinsics 和 frame | 第一次回复之前为 null；之后为最近一次回复的内参和帧尺寸，searching 时也是 |
| P3-TRK-38 | B2 的时机（OQ-40） | 非安全和不支持两种情况 | 只有 starting 是同步发出的；错误更新在 `startCameraAR` 返回之后才到 |
| P3-TRK-39 | 测试接缝（§8，OQ-02） | 在 Vitest 的 node 环境中提供全部依赖 | `startCameraAR` 运行时不访问 `window`、`navigator`、`document` |
| P3-TRK-40 | 选项（OQ-32） | analysisLongSide 为 0 或 −1；holdMs 为 −1 | `startCameraAR` 抛 `RangeError` |

### 5.2 静态检查

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P3-ARCH-01 | §5.1 最后一条（OQ-03） | 扫描 `heroScene.ts` | 从 `src/ar/board` 导入 `BOARD`；`COLS`、`ROWS`、`SQUARE` 由它得出（没有字面量 10、7、0.24） |

界面文案只做手动检查（OQ-04）：M3-06 和 M4-05。

## 6. P4 标定板视图、二维码与 PDF

### 6.1 `src/app/chessboard.pdf/route.ts`（§5.8）

用到的数值：25 mm = 70.8661 pt；50 mm = 141.7323 pt；标定板 708.661 × 496.063 pt；在页面居中（OQ-50）时其左下角为 (66.669, 49.468)，格子 (0, 0) 的范围是 x 66.669–137.535、y 474.665–545.531（PDF 的 y 轴向上）。

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P4-PDF-01 | `dynamic` | 导入模块 | `dynamic === "force-static"` |
| P4-PDF-02 | 响应 | `await GET()` | `Response`，状态 200，`Content-Type` 严格等于 `application/pdf` |
| P4-PDF-03 | 文件头与结尾（OQ-54） | 响应体字节 | 第 0–7 字节为 `%PDF-1.4`；文件以 `%%EOF` 结尾，其后至多一个换行 |
| P4-PDF-04 | 交叉引用偏移 | 解析 `startxref`、交叉引用表、trailer | `startxref` 指向 `xref`；一个 `0 N` 子段，N 项且每项恰好 20 字节；第 0 项为 `0000000000 65535 f`；每个使用中的偏移都指向 `k 0 obj`；trailer 的 `/Size` = N |
| P4-PDF-05 | trailer 的 `/Root`，单页 | 沿引用查找 | `/Root` → `/Type /Catalog` → `/Pages`（`/Type /Pages`、`/Count 1`、`/Kids` 只有一项）→ `/Type /Page`，其 `/Parent` 指回 Pages；所有引用都能解析 |
| P4-PDF-06 | A4 横向 | 页面字典 | 有效的 `/MediaBox [0 0 842 595]`（自身或继承）；没有 `/Rotate`（或为 0）；没有小于 MediaBox 的 `/CropBox` |
| P4-PDF-07 | 流（OQ-54） | 内容流 | `/Length` 等于实际流长度；未压缩或 FlateDecode 都能解码 |
| P4-PDF-08 | 35 个暗格填黑色 | 解释后的内容 | 恰好 35 个黑色填充（`0 g`、`0 0 0 rg` 或 `0 0 0 1 k`），每个都是边长 70.866 ± 0.01 pt 的轴对齐正方形 |
| P4-PDF-09 | 布局 | 同上 | 这些格子位于间距 70.866 ± 0.01 pt 的 10 × 7 网格上；从页面顶部数行，格子 (r, c) 当且仅当 r + c 为偶数时为黑，所以格子 (0, 0) 在左上；亮格都不是黑色 |
| P4-PDF-10 | 居中（OQ-50） | 标定板外框 | 两个方向都在页面正中，误差 ≤ 0.5 pt（下边缘在 49.468 pt） |
| P4-PDF-11 | 白色背景（OQ-55） | 所有填充 | 除 35 个格子、比例尺和字形外没有其他填充；标定板下面没有非白色（背景就是页面本身的白色） |
| P4-PDF-12 | 说明文字 | 文字片段与字体资源 | Helvetica 字体（`/Subtype /Type1 /BaseFont /Helvetica`）；有效字号（Tf × 文本矩阵 × CTM 缩放）≤ 10 pt；解码后的文字等于 "SceneGraph AR board · 10×7 squares, 9×6 inner corners · 25 mm squares · print at 100% (actual size)"；基线在标定板下方、页面底边之上；起点 x ≥ 0 |
| P4-PDF-13 | 说明文字的编码（OQ-51） | 字体字典与字符串字节 | `/Encoding /WinAnsiEncoding`；· 和 × 是字节 0xB7、0xD7 |
| P4-PDF-14 | 50 mm 比例尺（OQ-52） | 标定板下方的填充和文字 | 一个长 141.732 ± 0.05 pt 的实心条，位于标定板下方、页面内，旁边有"50 mm"标注 |
| P4-PDF-15 | 字节可复现（OQ-53） | 调用两次 `GET()` | 响应体相同 |
| P4-PDF-16 | 只用 PDF 1.4 的特性 | 整个文件 | 没有交叉引用流和对象流（不出现 `/Type /XRef`、`/ObjStm`） |

## 7. 实拍照片样例（D12）

### 7.1 文件与清单

- 照片是 JPEG 文件，用 macOS `sips` 统一缩放到长边 640 px（例如 `sips -Z 640 IMG_0001.jpg --out tests/fixtures/board/01-desk-frontal.jpg`），测试中用 jpeg-js 0.4.4 解码（OQ-06）。测试辅助代码自己按 BT.601 公式转灰度，不调用 `rgbaToGray`。
- jpeg-js 会忽略 EXIF 方向标记，所以标注针对的是解码后的像素网格。要么先把照片存成正向，要么按解码后的画面标注。
- `tests/fixtures/board/manifest.json` 是由条目组成的 JSON 数组。照片加入之前它是空列表，为空时整组测试跳过。

```json
[
  {
    "file": "01-desk-frontal.jpg",
    "expect": "found",
    "device": "iPhone, rear camera 1x",
    "board": "paper",
    "conditions": ["frontal", "office light"],
    "corners": { "0": [112.5, 80.0], "8": [520.0, 84.5], "45": [110.0, 300.5], "53": [522.5, 298.0] },
    "notes": ""
  }
]
```

- `expect`：`"found"`、`"null"` 或 `"either"`（介于两者之间的照片，如反光）。
- `corners`（可选）：角点 0、8、45、53 的大致像素位置，按 O1–O3 规则手工标注：角点 0 是挨着某个暗色角格的内角点，且从它出发沿长边（i）走时，短边（j）在屏幕上位于顺时针一侧（y 向下时 cross > 0）。

### 7.2 检查

| 编号 | 条款 | 准备 / 输入 | 预期 |
| :--- | :--- | :--- | :--- |
| P1-FIX-01 | §9 清单 | 清单与文件 | 格式合法；文件名不重复；至少 5 条；每张照片解码后为 w · h 个灰度值，长边 640 px |
| P1-FIX-02 | §5.2 结果 | `expect: "found"` | 非 null，长度 108 |
| P1-FIX-03 | O2 | 同上 | cross(p(1,0) − p(0,0), p(0,1) − p(0,0)) > 0 |
| P1-FIX-04 | O3 | 用拟合到结果上的单应找到各格中心 | 应为暗格的平均灰度比应为亮格的平均灰度低 ≥ 20 级；格子 (0, 0) 比应为亮格的中位数暗 |
| P1-FIX-05 | §9 残差 | `fitHomography(标定板角点, result)` | 几何 RMS 残差 ≤ 1.5 px（这也覆盖 O1：转置或打乱的布局拟合不上） |
| P1-FIX-06 | §5.2 拒识 | `expect: "null"`；`expect: "either"` | null；null 或通过 P1-FIX-02…05 |
| P1-FIX-07 | 用人工标注核对 O1–O3 | 有 `corners` 的条目 | 结果的角点 0、8、45、53 离标注 ≤ 3 px |
| P1-FIX-08 | 确定性、跟踪提示 | 运行两次；`previous` = 自身结果；`previous` = 反转的自身结果（k ↔ 53 − k） | 两次运行相同；每次带提示的运行都通过 P1-FIX-02…05（有标注时还要通过 P1-FIX-07） |

### 7.3 建议的照片（5–10 张打印出来的标定板）

| # | 内容 | expect |
| :--- | :--- | :--- |
| 1 | 正对，办公室均匀光照 | found |
| 2 | 倾角约 45° | found |
| 3 | 倾角约 60°，标定板在画面中较小 | found |
| 4 | 标定板倒置（面内旋转 180°） | found |
| 5 | 标定板旋转约 90°（长边竖直） | found |
| 6 | 强反光或一道阴影横过标定板 | either |
| 7 | 轻微运动模糊 | either |
| 8 | 标定板有一部分在画面外 | null |
| 9 | 手挡住一个内角点 | null |
| 10 | 可选：显示在屏幕上的标定板 | either |

## 8. 手动检查清单

不自动化的部分：WebGL 输出（§5.6）、界面行为 U1–U12（§5.7，包括文案，OQ-04）、摄像头授权流程、真机。每个阶段结束时还要跑 `npm run lint`、`npx tsc --noEmit` 和 `next build`。

### 8.1 P1

| 编号 | 条款 | 步骤 | 预期 |
| :--- | :--- | :--- | :--- |
| M1-01 | §9 | lint、tsc、build | 无报错；网站外观不变（新模块尚未使用） |

### 8.2 P2

| 编号 | 条款 | 步骤 | 预期 |
| :--- | :--- | :--- | :--- |
| M2-01 | §12 worker 打包（OQ-60） | 临时加一处不提交的 `new Worker(new URL("./tracker.worker.ts", import.meta.url), { type: "module" })` 引用，运行 `next build`，然后删掉 | 生成单独的 worker 分块，且其中没有 three.js（在分块里搜索 `WebGLRenderer`） |
| M2-02 | §9 | lint、tsc、build | 无报错 |

### 8.3 P3

| 编号 | 条款 | 步骤 | 预期 |
| :--- | :--- | :--- | :--- |
| M3-01 | U1、D10、D14、D9 | 通过 HTTPS（Vercel 预览）打开首页；在手机上通过局域网 `http://` 地址打开；在支持 WebXR 的设备上打开 | 「用摄像头看 AR」 / "Try camera AR" 按钮只在安全上下文且有 `getUserMedia` 时出现；位于 hero 视口右下角、WebXR 按钮之前；那里不再显示移动鼠标的提示；支持 WebXR 的设备上两类按钮都出现 |
| M3-02 | U2（P3）、OQ-58 | 点按钮；后退；重新打开后点 ✕；重新打开后按 Esc；直接加载 `?ar=camera` 后点 ✕；加载 `?ar=foo`；在不支持摄像头的环境中加载 `?ar=camera` | 推入 `?ar=camera`；后退即关闭；✕ 和 Esc 调用 `history.back()`（参数消失，不离开页面）；直接加载时立即打开浮层并启动摄像头（D6），之后点 ✕ 替换 URL，不离开网站；`?ar=foo` 被忽略（不打开浮层，URL 不动）；不支持摄像头时 `?ar=camera` 打开浮层并显示不支持的提示 |
| M3-03 | U3、OQ-57 | 打开，尝试滚动，关闭；再在入口按钮隐藏的情况下从 URL 打开 | hero 动画停止（FPS 读数不再变化）；页面不滚动；焦点回到入口按钮，没有按钮时回到 hero 视口 |
| M3-04 | U4 | 首次加载和打开浮层时看网络面板；比较改动前后的 `next build` 输出 | tracker、pose 和场景胶水代码只在打开时加载；首页包体只多了按钮；worker 分块里没有 three.js |
| M3-05 | U5、D2 | 手机竖屏和横屏；调整桌面浏览器窗口大小 | 全屏且在导航栏之上；`<video playsinline muted autoplay>`，`object-fit: cover`；在各种宽高比下角点标记都落在打印的角点上；不镜像（标定板向左移，屏幕上也向左移） |
| M3-06 | U6、D7、OQ-04 | 各个状态，中英文 | 文案与 U6 完全一致；显示跟踪 fps；位置读数 "x … y … z … m · …°"，按 25 mm 格子换算成米，并有说明；手机在标定板中心上方约 30 cm 时读数约为 y ≈ 0.30 m |
| M3-07 | U7、B2、B4 | 把 `getUserMedia` 改成以 NotAllowedError、NotFoundError、OverconstrainedError、NotReadableError 拒绝；删除 `navigator.mediaDevices`；通过局域网 `http://` 打开 `?ar=camera` | denied、no-camera、failed、unsupported、insecure 各有简短说明和关闭按钮；denied 说明如何重新允许摄像头 |
| M3-08 | U8、OQ-56 | VoiceOver 或无障碍检查工具；只用键盘 | `role="dialog"`、`aria-modal="true"`、有可访问名称；打开时焦点在关闭按钮上（✕，带 `aria-label`）；Tab 在浮层内循环；Esc 关闭 |
| M3-09 | §5.6 `createCameraScene` | 跟踪一块标定板 | 城堡、按行着色并像 `drawChessboardCorners` 那样连线的角点、角点 0 处的坐标轴（红沿 i、绿沿 j、蓝从板面朝向相机）、底部阴影、扫描圆环；画布透明；没有标定板网格、浮尘、地面网格和鼠标视角 |
| M3-10 | §5.6 `setPose`、D3 | 把标定板移出画面再移回 | 城堡保留约 0.5 s 后消失；标定板回来时城堡重新出现 |
| M3-11 | D13 | 打开"减少动态效果" | 摄像头 AR 仍可用；扫描圆环静止 |
| M3-12 | §5.6 `dispose`、B9 | 打开关闭 10 次 | 没有 WebGL 上下文警告；画布被移除；每次关闭后摄像头指示灯熄灭 |
| M3-13 | §5.6 `setPaused` | hero 运行时打开关闭浮层；在支持 WebXR 的设备上先进入 XR 会话，再尽量打开浮层 | 浮层打开期间 hero 循环停止，关闭后恢复；XR 会话不受影响 |
| M3-14 | §9 模拟视频流 | 在浏览器面板里把 `getUserMedia` 换成一个画着移动标定板的 canvas `captureStream(30)`；让它空白 1 s；再改成拒绝 | starting → searching → tracking；浮层跟随标定板；保持约 0.5 s 后转为 searching；错误状态同 M3-07 |
| M3-15 | 真机：iPhone Safari | 当前 iOS；旋转手机；锁屏再解锁 | 弹出授权；使用后置摄像头（D4）；视频不会被系统接管成全屏；640×360 下每秒 ≥ 20 次跟踪结果（§5.2）；旋转后约 1 s 内恢复跟踪 |
| M3-16 | 真机：Android Chrome | 同上 | 同上 |
| M3-17 | 真机：桌面摄像头 | Chrome、Safari、Firefox | 使用默认摄像头；不镜像；`requestVideoFrameCallback` 路径和 `requestAnimationFrame` 后备都能跟踪 |
| M3-18 | 纸上的标定板 | 打印的 10×7、25 mm 格子标定板；办公室光照；倾角 0–60°；距离 20–80 cm；反光；手挡住一个角点 | 跟踪稳定；角点被挡住时城堡消失而不是乱跳 |
| M3-19 | 屏幕上的标定板 | 在笔记本或平板上显示标定板（P4 之前用任意标定板图片） | 有摩尔纹和反光也能跟踪；记下局限 |
| M3-21 | §9 | lint、tsc、build | 无报错 |

### 8.4 P4

| 编号 | 条款 | 步骤 | 预期 |
| :--- | :--- | :--- | :--- |
| M4-01 | U2（P4）、D5、OQ-58 | 在桌面（无粗指针）和触屏设备上点击；直接加载 `?ar=board` | 桌面推入 `?ar=board`，触屏推入 `?ar=camera`；直接加载时打开标定板视图 |
| M4-02 | U7（P4） | 任意错误状态 | 提供"改为显示标定板" |
| M4-03 | U9 | 摄像头视图 | "显示标定板"切换到标定板视图；"打印标定板（PDF）"下载 `/chessboard.pdf` |
| M4-04 | U10、OQ-59 | 竖屏和横屏下的标定板视图；等待超过屏幕自动关闭的时间；离开标定板视图；关闭浮层 | 10×7 标定板在白色面板上，白边至少半格，尽量大，格子 (0, 0) 在左上；有 Wake Lock API 时屏幕保持常亮；离开标定板视图或关闭浮层时释放 |
| M4-05 | U11、OQ-04 | 桌面和触屏，中文和英文 | 桌面：标定板旁有二维码，解码为 `${origin}/${lang}?ar=camera`，说明 「用手机扫码，对准这块屏幕」 / "Scan with your phone and point it at this screen"。触屏：没有二维码，说明 「用另一台设备的摄像头对准这块屏幕」 / "Point another device's camera at this screen" |
| M4-06 | U12、OQ-59 | "用这台设备的摄像头"；不支持摄像头的浏览器 | 切换到摄像头视图；URL 参数被替换为 `camera`；后退关闭浮层。不支持摄像头时不显示这个操作 |
| M4-07 | §5.8 打印 | 在"预览"和 Chrome 中打开 `/chessboard.pdf`；在 A4 纸上按 100 % 打印 | 单页横向；格子 25.0 ± 0.3 mm；比例尺 50.0 ± 0.5 mm 且带标注；说明文字清晰；打印件能被跟踪（M3-18） |
| M4-08 | Q3 交接 | 桌面标定板视图 → 用 iPhone 扫二维码 → 对准屏幕 | 摄像头立即启动（D6）并跟踪屏幕上的标定板 |
| M4-09 | §2 静态导出 | `next build`；预览部署 | `out/chessboard.pdf` 存在且与路由的响应体相同；以 `application/pdf` 提供 |
| M4-10 | §9 | lint、tsc、build | 无报错 |

## 9. 用例数量与状态

| 阶段 | 自动化契约用例 | 辅助工具自检 | 实拍照片用例（D12） | 手动 |
| :--- | ---: | ---: | ---: | ---: |
| P1 | 75 | 9（H-01…H-08、H-11） | 8 | 1 |
| P2 | 106 | 0 | — | 2 |
| P3 | 41 | 1（H-09） | — | 20 |
| P4 | 16 | 1（H-10） | — | 10 |
| 合计 | 238 | 11 | 8 | 33 |

P1 的 Red 检查，2026-11-02，针对骨架代码（桩函数抛出 `new Error("not implemented")`）：
- `npx vitest run`：7 个文件共 92 个测试。73 个失败，失败原因都是 `Error: not implemented`，没有其他原因。11 个通过：9 个辅助工具自检，以及检查 `BOARD` 的 P1-BRD-01 和 P1-BRD-07（骨架已把它实现为冻结的常量）。8 个 P1-FIX 用例因清单为空而跳过。
- `npx tsc --noEmit` 和 `npx eslint tests`：无报错。
- 目录中全部 305 个场景都能渲染、不报错，约 6.5 s。

P2 分两批进行：P2a 是 `tests/ar/pose.test.ts`，含本计划 §4.1–§4.4 的 45 个用例（最初 44 个，后为 OQ-69 增加 P2-PNP-16）；P2b 是本计划 §1.1 中其余的 P2 文件，含剩下的 61 个用例。

P2a 的 Red 检查，2026-11-02，针对 `src/ar/pose.ts` 的骨架代码（每个函数都抛出 `new Error("not implemented")`）：
- `npx vitest run tests/ar/pose.test.ts`：44 个测试全部失败，失败原因都是桩函数抛出的 `Error: not implemented`（`intrinsicsFromFov` 4 个、`solvePlanarPnP` 14 个、`estimateFocal` 10 个、`viewMatrix` 6 个、`projectionMatrix` 7 个、`cameraPosition` 3 个），没有其他原因。`npx vitest run`：8 个文件共 136 个测试；P1 不变，84 个通过、8 个跳过。
- `npx tsc --noEmit` 和 `npx eslint tests`：无报错。
- 种子在实现之前就已固定。用一次性的离线参考实现（Levenberg–Marquardt 迭代到收敛；由归一化 DLT 求焦距的闭式解）在完全相同的试验上得到：P2-PNP-03…05 旋转误差最大 3 · 10⁻¹⁵ rad；P2-PNP-09 旋转误差最大 0.27°（倾角 35–60°，界限 0.5°）和 1.24°（倾角 0–35°，界限 3°），平移误差最大 0.19 %（界限 1 %）；P2-PNP-10 与真实位姿的余量至少 2.4 · 10⁻³ px，与仅由单应得到的位姿的余量至少 7.4 · 10⁻⁵ px；P2-PNP-11 的最小相对上升为 6.6 · 10⁻⁷，出现在接近正对时绕板面内轴的旋转（求解器在这个方向上要收敛到约 5 · 10⁻⁵ rad 以内；从单应位姿出发迭代两次 LM 就够）；P2-FOC-02 最大误差 1.3 · 10⁻¹⁴（界限 1 %）；P2-FOC-03 最大 1.7 %（界限 10 %）。P2-FOC-04 与 P2-FOC-06（P2-FOC-02 也属于有值一侧）的 null/有值划分，可以用一条尺度不变的两级规则分开：只有当透视比 q = ‖(h31, h32)‖ · ρ_obj · W / (|w_c| · ρ_img) 至少为 0.25（w_c 为物点质心处的齐次权重，ρ 为物点和像点的 RMS 半径；q ≈ 2 sin(倾角) · tan(hfov / 2)），并且由估计焦距推出的倾角至少为 17.5° 时才返回值。null 一侧的每次试验都满足 q ≤ 0.102 或推出的倾角 ≤ 10.4°；有值一侧 q ≥ 0.364 且推出的倾角 ≥ 24.4°。在另外 14,700 次试验（hfov 40–100°，倾角 0°、5°、9.5° 和 25°，精确和加噪，都在 OQ-24 范围内）中，这条规则从未违反契约；只用 q 违反 1,209 次（它依赖 hfov），只用推出的倾角违反 15 次（接近正对时焦距被高估）。参考实现用这条两级规则能通过全部 44 个测试；只用其中任一条单一规则时，只有 P2-FOC-04 失败。

P2a 针对 OQ-69 和 OQ-70 的补充，2026-11-02，针对已实现的 `src/ar/pose.ts`：
- `npx vitest run tests/ar/pose.test.ts`：45 个测试，44 个通过（含新增的 P2-PNP-16），P2-PM-06 失败，报 `AssertionError: K with fx 0: expected a RangeError, but nothing was thrown`。它的 9 个 K 输入目前都不抛错（每个都让 P 的某个元素成为 0、负数、NaN 或 ±Infinity），所以在 `projectionMatrix` 校验 K（OQ-70）之前，这个用例保持为红。
- P2-PNP-16 有区分力：把 `pose.ts` 复制到 scratch 并去掉其中的 t_z > 0 检查后，三块标定板分别得到 t_z 为 −1.000、−2.642、−2.362 的位姿（rms ≤ 1.3 · 10⁻¹³），P2-PNP-16 因此失败；45 个用例中只有它能发现这个改动。
- `npx vitest run`：8 个文件共 137 个测试，128 个通过、1 个失败（P2-PM-06）、8 个跳过。`npx tsc --noEmit` 和 `npx eslint tests`：无报错。

## 10. 已定问题

2026-11-02 定下；OQ-61–OQ-68 是编写 P2a 测试时提出的，OQ-69–OQ-70 是其评审时提出的，均于同日定下。"A""B"指本计划初稿中提出的方案（OQ-61–OQ-70 指 P2a 评审时提出的方案）；设计文档 §14 列出了相同的决议。

### 10.1 OQ-18、OQ-23、OQ-27 的依据

在把统计性条款写成测试之前，用一次性的、带种子的 Node 脚本（不在仓库里）做了验证。

`solvePlanarPnP` 加噪精度（OQ-18）。640×360，hfov 60°（f = 554.26 px），54 个角点每个坐标分量加 σ 0.3 px 噪声，标定板居中，深度取使投影后标定板恰好占图宽的给定比例，倾斜轴和面内旋转随机。估计器为从真实位姿出发、对重投影误差做 Gauss–Newton，即最大似然估计，是任何正确求解器所能达到的最好结果（与 Cramér–Rao 界一致）。

| 倾角 | 标定板宽度 | 单次旋转误差 > 0.5° 的概率 | 20 次全部通过的概率（未注明时界限为 0.5°） |
| :--- | :--- | ---: | ---: |
| 0° | 1/3 | 67.5 % | 0.000 |
| 10° | 1/3 | 38.5 % | 0.000 |
| 20° | 1/3 | 7.7 % | 0.199 |
| 30° | 1/3 | 0.7 % | 0.860 |
| 45°、60° | 1/3 | 0 % | 1.000 |
| 0–60° 均匀 | 1/3 | — | 0.056 |
| 35–60° 均匀 | 1/3 | 3,000 次中最大 0.44° | 1.000 |
| 0–35° 均匀，界限 3° | 1/3 | 3,000 次中最大 1.91° | 1.000 |
| 恰好 0°，界限 3° | 1/3 | 3,000 次中最大 3.34° | 0.993 |
| 20–60° 均匀 | 1/2 | — | 0.993 |

平移误差：400 次（倾角 0–60°，占图宽 1/3）中最大 0.27 %，远小于 1 %。

`estimateFocal`（OQ-23、OQ-24）。由归一化 DLT 单应求闭式解，σ 0.3 px，每行 4,000 次：

| 倾角 | 标定板宽度 | 误差中位数 | 99 分位 | 误差 > 10 % 的概率 |
| :--- | :--- | ---: | ---: | ---: |
| 45° | 40 % | 0.63 % | 3.3 % | 0 % |
| 30° | 40 % | 0.94 % | 4.3 % | 0 % |
| 25° | 40 % | 1.2 % | 5.3 % | 0 % |
| 10° | 40 % | 4.0 % | 19 % | 12 % |
| 5° | 40 % | 13.5 % | 159 % | 61 % |

倾角 30–60° 的精确数据：最大误差 4 · 10⁻¹³。偏离中心放置的正对标定板（R = I）在机器精度内 h31 = h32 = 0，闭式解给出 6 · 10¹¹ px。

角点滤波器（OQ-27、OQ-28）。默认参数（minCutoff 1、beta 0.05、dCutoff 1），30 fps：

| One Euro 变体 | 12 px x 方向阶跃：首个进入 0.5 px 的输出 | 12 px 对角线阶跃 | 抖动标准差比，合计 / 最差坐标 |
| :--- | ---: | ---: | :--- |
| α = 1/(1 + τ/T_e)，导数取自上一次滤波值 | 5 | 6 | 0.34 / 0.41 |
| α = 1/(1 + τ/T_e)，导数取自上一次原始值（Casiez 的参考 C++ 实现） | 7 | 9 | 0.33 / 0.40 |
| α = 1 − exp(−T_e/τ)，上一次滤波值 | 4 | 4 | 0.36 / 0.43 |
| α = 1 − exp(−T_e/τ)，上一次原始值 | 5 | 7 | 0.35 / 0.42 |

在需要秒的地方传入毫秒，一帧之后 12 px 阶跃只剩 0.06 px，几乎没有平滑（OQ-01）。按 OQ-27 只测行为条款，所以实现必须选一种能满足这些条款的写法；§7 建议导数取自上一次滤波值。

### 10.2 问题表

| 编号 | 条款 | 问题 | 选定 | 决议 | 涉及用例 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| OQ-01 | §5.4 `createCornerFilter` | `apply(corners, time)` 中 `time` 的单位 | A | 毫秒，与 `FrameInput.time` 一致 | P2-CF-*、P2-PIP-07 |
| OQ-02 | §5.5 deps、§8 | 默认依赖是否必须延迟解析，以便测试在 Node 中运行？ | A | 是：只在某个依赖缺失时才解析其默认实现 | P3-TRK-39 |
| OQ-03 | §4、§5.1 | 怎样检查依赖方向和 heroScene 对 `BOARD` 的使用 | A | 静态 import 扫描测试 | P2-ARCH-01、P2-ARCH-02、P3-ARCH-01 |
| OQ-04 | §5.7 文案 | 是否对 `profile.ts` 做自动文案检查？ | B | 否：文案只做手动检查 | M3-06、M4-05 |
| OQ-05 | §5.2 性能 | 性能测试是否放进默认测试集？ | A | 是，界限为目标的 3 倍（90 ms、15 ms），记录中位数 | P1-PERF-* |
| OQ-06 | §9 实拍照片 | 照片样例的格式 | B（变体） | 用 macOS `sips` 缩放到长边 640 px 的 JPEG 文件，用开发依赖 jpeg-js 0.4.4 解码 | P1-FIX-* |
| OQ-07 | §5.1 `BOARD` | 运行时是否冻结？ | A | 是，`Object.freeze` | P1-BRD-07 |
| OQ-08 | §5.2 `rgbaToGray` | `out` 能否与 `rgba` 共享内存？ | A | 否：不支持，不测 | P1-GRY-09 |
| OQ-09 | §1、§5.2 | 哪些点阵尺寸享有保证？ | B（变体） | 只有 (9, 6) 和 (6, 9)；其他尺寸只作为拒识 (d) 的反例出现 | P1-DET-05、P1-DET-32；删除 P1-DET-11 |
| OQ-10 | §5.2 拒识 | 标称条件之外怎样算错误结果？ | A | 长度不对、违反 O1–O3，或有角点离它自己的真值超过局部间距的 0.3 倍 | P1-DET-35、P1-DET-52 |
| OQ-11 | §5.2 边缘豁免 | 3 px 豁免带是否双侧？外圈格子被截断时结果是否必须非 null？ | A | 双侧豁免带；null 或准确（只在标称条件下承诺非 null） | P1-DET-37、P1-DET-38 |
| OQ-12 | §5.2 标称条件 | 对比度在渐变前还是后测；白边灰度 | A | 渐变之后、每一处都测；白边与亮格同灰度 | P1-DET-18 |
| OQ-13 | §5.2 (c) | 哪些遮挡必须返回 null？ | A | 遮挡物盖住以内角点为中心、半径 ≥ 0.3 格的圆，或角点被破坏 → null；更小的部分遮挡和不在角点上的遮挡 → null 或准确 | P1-DET-28、P1-DET-29、P1-DET-33 |
| OQ-14 | §1、§5.2 | 一幅图里有两块完整的标定板 | A | null，或其中一块满足保证 | P1-DET-34 |
| OQ-15 | §5.2 跟踪提示 | "移动 ≤ 0.25 格"怎么量？ | A | 每个角点在图像中的位移 ≤ 0.25 × 最短投影格边；不扩大适用范围 | P1-DET-40 |
| OQ-16 | §5.2 性能 | 没有标定板的帧 | A | 与找到的帧目标相同（30 ms；按 90 ms 测试） | P1-PERF-03 |
| OQ-17 | §5.2 结果 | 结果 buffer 是否恰好等长？ | A | 是：byteOffset 0，byteLength = 8 · cornersX · cornersY | P1-DET-57 |
| OQ-18 | §5.3 PnP 加噪精度 | 接近正对时 0.5° 的界限达不到 | A | 倾角 35–60°：旋转 ≤ 0.5°；倾角 0–35°：旋转 ≤ 3°；两者平移都 ≤ 1 % | P2-PNP-09 |
| OQ-19 | §5.3 精确投影精度 | 1e−6 界限的适用范围 | A | 与加噪测试相同的范围（标定板 ≥ 图宽 1/3，倾角 ≤ 60°），加 N = 4 的最小点集 | P2-PNP-03、P2-PNP-04；删除 P2-PNP-06 |
| OQ-20 | §5.3 退化情形 | 4 个点中有 3 点共线 | A | 除非点集中有 4 个点满足任意三点不共线，否则返回 null | P2-PNP-12 |
| OQ-21 | §5.3 退化情形 | 只能用"标定板在相机后方"来解释的对应点 | A | null | P2-PNP-13 |
| OQ-22 | §5.3 参数校验 | 非有限与非整数的尺寸；`viewMatrix` 和 `cameraPosition` 的参数 | A | 非有限尺寸抛 `RangeError`；允许非整数尺寸；`viewMatrix`、`cameraPosition` 不校验 | P2-INT-04、P2-FOC-01、P2-PM-06 |
| OQ-23 | §5.3 `estimateFocal` | 用哪种倾角？ | A | 标定板法线与光轴的夹角 | P2-FOC-04…07 |
| OQ-24 | §5.3 `estimateFocal` | "倾角 ≥ 25° 时返回数值"的条件 | A | 精确或 σ ≤ 0.3 px 的对应点，标定板 ≥ 图宽 40 %，倾角 25–60° | P2-FOC-06 |
| OQ-25 | §5.3 `estimateFocal` | 退化点集 | A | null | P2-FOC-08 |
| OQ-26 | §5.3 `projectionMatrix` | 裁剪空间 w 为正与可逆性 | A | w = k · Z 且 k > 0，det P ≠ 0 | P2-PM-05 |
| OQ-27 | §5.4 角点滤波器 | One Euro 的写法 | B | 只测行为条款；写法（导数取自上一次滤波值）作为 §7 的实现指引；不与参考实现对比 | P2-CF-09、P2-CF-11 |
| OQ-28 | §5.4 抖动条款 | 输出标准差怎么量？ | A | 300 帧中第 11–300 帧、逐坐标计算 | P2-CF-08 |
| OQ-29 | §5.4 阶跃条款 | 噪声、距离和计数方式 | A | 无噪声；按角点的欧氏距离；从新位置的第 6 个输出起 | P2-CF-09、P2-CF-10 |
| OQ-30 | §5.4 焦距跟踪器 | 偶数个估计值的中位数 | A | 取中间两个值的平均 | P2-FT-06 |
| OQ-31 | §5.4 焦距跟踪器 | 非有限或非正的估计值 | A | 与 null 一样忽略 | P2-FT-11 |
| OQ-32 | §5.4、§5.5 选项 | 选项校验 | A | 创建或启动时抛 `RangeError` | P2-OPT-01、P3-TRK-40 |
| OQ-33 | §5.4 第 2、4 步 | PnP 返回 null 的帧之后的提示 | A | 保留它的原始角点作为提示 | P2-PIP-06 |
| OQ-34 | §5.4 第 3 步 | 未找到时的 `intrinsics` | A | { fx = fy = tracker.focal(width), cx = (width − 1)/2, cy = (height − 1)/2 } | P2-PIP-22 |
| OQ-35 | §5.4 `process` | 格式错误的帧 | A | `RangeError`；流水线状态不变 | P2-PIP-21 |
| OQ-36 | §5.4 `handleWorkerMessage` | 错误文字；非对象消息 | A | `Error` 取 `error.message`，其他取 `String(value)`；非对象消息返回 null 且不抛错 | P2-WRK-07、P2-WRK-08 |
| OQ-37 | §5.5 `TrackingUpdate` | 非 tracking 时的 `intrinsics` 和 `frame` | A | 第一次回复之前为 null，之后为最近一次回复的值，searching 时也是 | P3-TRK-01、P3-TRK-37 |
| OQ-38 | §5.5 B7 | 保持的边界；保持期的字段 | A | ≤ holdMs 算以内；保持期的更新带上次找到的回复的内参和帧尺寸 | P3-TRK-26 |
| OQ-39 | §5.5 B8 | fps 统计窗口的边界 | A | now − t < 1000 ms 的回复计入，包括当前这次 | P3-TRK-28 |
| OQ-40 | §5.5 B2 | insecure/unsupported 更新的时机 | A | 在 `startCameraAR` 返回之后 | P3-TRK-38 |
| OQ-41 | §5.5 B4 | `play()` 被拒绝 | A | 一律 `failed` | P3-TRK-09 |
| OQ-42 | §5.5 B4 | 依赖抛出的异常 | A | error/failed：终止并释放资源 | P3-TRK-12 |
| OQ-43 | §5.5 B9 | `stop()` 之后 `getUserMedia` 才完成 | A | 停止它的 track；不设置 `srcObject`；不调用 `play()` | P3-TRK-31 |
| OQ-44 | §5.5 B9 | `stop()` 的幂等 | A | `terminate()` 和每个 track 的 `stop()` 恰好各调用一次 | P3-TRK-30 |
| OQ-45 | §5.5 B6、B7 | 帧 id 与对不上的回复 | A | id 严格递增；id 对不上的回复忽略 | P3-TRK-20 |
| OQ-46 | §5.5 B6 | worker 永远不回复 | A | 不设看门狗（范围外） | — |
| OQ-47 | §11 主线程后备方案 | "隔帧处理"与"同时只有一帧" | — | 设计中删除了后备方案；其用例一并删除 | 删除 P3-TRK-41 |
| OQ-48 | §5.5 B6 | 分析尺寸的舍入 | A | `Math.round`；每边 ≥ 1 | P3-TRK-17 |
| OQ-49 | §5.5 B6 | 发出帧的 `time` | A | 采集时的 `deps.now()` | P3-TRK-15 |
| OQ-50 | §5.8 | "居中"的含义 | A | 两个方向都在页面正中 | P4-PDF-10 |
| OQ-51 | §5.8 说明文字 | Helvetica 下的 · 和 × | A | 通过 `/WinAnsiEncoding` 使用原字符（字节 0xB7、0xD7） | P4-PDF-12、P4-PDF-13 |
| OQ-52 | §5.8 比例尺 | 形式与标注 | A | 长 141.73 pt 的实心条，标注"50 mm" | P4-PDF-14 |
| OQ-53 | §5.8 | 输出逐字节相同 | A | 必须 | P4-PDF-15 |
| OQ-54 | §5.8 结构 | `%%EOF` 后的换行；内容压缩 | A | 允许一个换行；未压缩或 FlateDecode 都行 | P4-PDF-03、P4-PDF-07 |
| OQ-55 | §5.8 | 白色背景 | A | 隐式：标定板下面没有非白色的填充 | P4-PDF-11 |
| OQ-56 | §5.7 U8 | 焦点锁定 | A | Tab 在浮层内循环 | M3-08 |
| OQ-57 | §5.7 U3 | 没有入口按钮时关闭后的焦点 | A | hero 视口 | M3-03 |
| OQ-58 | §5.7 U2 | 未知的 `?ar` 值；不支持摄像头时的 `?ar=camera` | A | 未知值忽略；不支持时 `?ar=camera` 打开浮层并显示不支持的提示 | M3-02、M4-01 |
| OQ-59 | §5.7 U10、U12 | 不支持摄像头时的标定板视图；屏幕常亮锁的释放 | A | 不支持摄像头时隐藏"用这台设备的摄像头"；离开标定板视图或关闭浮层时释放 | M4-04、M4-06 |
| OQ-60 | §10、§12 | P2 的 worker 打包检查 | A | P2 中加一处临时、不提交的引用 | M2-01 |
| OQ-61 | §5.3 退化 | 像点中找不到 4 个处于一般位置的点 | A | 视为退化，返回 null | P2-PNP-12 |
| OQ-62 | §5.3 `estimateFocal` | 返回 null 和返回数值这两类保证的适用范围 | A | 真实 hfov 40–100°；倾角 < 10° 时，精确数据无论标定板多大都返回 null，σ ≤ 0.3 px 时标定板 ≥ 图宽 40 % 才保证返回 null；试验的 hfov 在 40–100° 内抽取 | P2-FOC-04…07、P2-FOC-10 |
| OQ-63 | §5.3 `estimateFocal` | 带噪声时的尺度不变性 | A | 精确数据和带噪声数据都在相对 1e−9 以内 | P2-FOC-10 |
| OQ-64 | §5.3 `projectionMatrix` | far = Infinity | A | 抛出 `RangeError`：near 和 far 必须是有限数 | P2-PM-06 |
| OQ-65 | §5.3 精度条件 | 标定板占图像宽度的比例怎么量 | A | 按 10 × 7 个格子的外边缘量 | P2-PNP-09…11、P2-FOC-03…06 |
| OQ-66 | §5.3 最小化 | P2-PNP-11 如何扰动位姿 | A | R ← Rot（绕经过板原点的某个相机坐标轴转 ±10⁻⁴ rad）· R，t 不变；t 每次只动一个分量 | P2-PNP-11 |
| OQ-67 | §5.3 退化、OQ-21 | 相机后方情形的构造 | A | 跨过相机 z = 0 平面的标定板返回 null；点反射 −P 的投影与 P 相同 | P2-PNP-13 |
| OQ-68 | §4 输入 | 初稿之外补充的输入 | A | 保留：hfov −Infinity、高度 360.5、P2-FOC-05 的试验数、P2-FOC-07 的四角方向和 20 % 板宽、P2-PNP-14 的一个加噪输入 | P2-INT-03、P2-INT-04、P2-FOC-05、P2-FOC-07、P2-PNP-14 |
| OQ-69 | §5.3 后置条件 | 标定板上的点都在相机前方，而板原点在相机后方 | A | 返回 null，以保证 t_z > 0；只有离原点很远的物点才会出现这种情况 | P2-PNP-16 |
| OQ-70 | §5.3 `projectionMatrix` | 是否校验 K | A | 与 `solvePlanarPnP` 一致：fx、fy、cx、cy 有非有限值，或 fx、fy ≤ 0 时抛出 `RangeError` | P2-PM-06 |
