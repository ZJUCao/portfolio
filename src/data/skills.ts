// 技能分组，以及识别项目技术栈用的对照表。
//
// 关于页的技能 = profile.ts 里手写的技能 + 项目里用到的技术。每个项目用了什么在构建时自动识别，
// 手写里还没有的补到对应分组的末尾，所以新项目上线后，它用到的技术会跟着出现在技能里，不用手动加。
//
// 识别方法：拿下面每项技术的名字和 match 里的写法（不分大小写，以 * 结尾表示前缀），对照每个仓库的
//   - GitHub 统计的语言，如 C++、GLSL、CMake、Dockerfile
//   - GitHub 上的 topics，如 ray-tracing、kd-tree
//   - 依赖：scripts/fetch-github.mjs 从 package.json、requirements.txt、pyproject.toml、CMakeLists.txt、vcpkg.json、
//     Unity 的 Packages/manifest.json、Unreal 的 .uproject 和 third_party/ 一类目录里收集的库名，
//     以及 Dockerfile、GitHub Actions、Unity / Unreal / Godot 工程这类文件
// 只有表里有的技术才会显示：想让某样技术自动出现就加一项，不想显示就删掉那一项。
// 算法、领域知识这类从依赖里看不出来的，给仓库在 GitHub 上加个 topic（如 ray-tracing、augmented-reality），
// 或者直接写进 profile.ts。
//
// 项目分类也参考这里的分组：项目用到哪个分组的技术，就可能归到对应的分类，见 projects.ts 里的 categories。

import type { Locale } from "@/i18n";

// 一项技术：中英文同名时直接写名字，否则写 { name, zh }。match 是名字以外的其他写法：
// 依赖的包名、topic，以及 profile.ts 里的写法（如 C/C++）——手写过的不会再重复添加
type Tech = string | { name: string; zh?: string; match?: string[] };

// 分组按这里的顺序显示；每组里自动补上的技术也按表里的顺序排
const groups = {
  languages: {
    zh: "编程语言",
    en: "Languages",
    techs: [
      { name: "C++", match: ["cpp", "C/C++"] },
      { name: "C", match: ["C/C++"] },
      { name: "C#", match: ["csharp"] },
      "Java", "Python", "JavaScript", "TypeScript", "Swift", "Kotlin", "Lua", "GLSL", "HLSL", "CUDA", "Rust", "Go",
    ],
  },
  // XR 的 SDK 和平台。Unity 包名（com.unity.xr.*）和 Unreal 插件名（OculusXR、AppleARKit）也写在 match 里
  xr: {
    zh: "XR 与空间计算",
    en: "XR & Spatial Computing",
    techs: [
      { name: "OpenXR", match: ["openxr-loader", "com.unity.xr.openxr"] },
      { name: "WebXR", match: ["@react-three/xr", "@types/webxr", "webxr-polyfill"] },
      { name: "AR Foundation", match: ["arfoundation", "com.unity.xr.arfoundation"] },
      { name: "XR Interaction Toolkit", match: ["com.unity.xr.interaction.toolkit"] },
      { name: "Meta XR SDK", match: ["com.meta.xr.*", "com.unity.xr.oculus", "oculusxr", "metaxr"] },
      { name: "ARKit", match: ["com.unity.xr.arkit", "applearkit"] },
      "RealityKit",
      { name: "ARCore", match: ["com.unity.xr.arcore", "googlearcore"] },
      { name: "visionOS", match: ["com.unity.xr.visionos", "com.unity.polyspatial*"] },
      { name: "MRTK", match: ["mixed-reality-toolkit", "org.mixedrealitytoolkit.*", "com.microsoft.mixedreality.toolkit.*"] },
      { name: "Vuforia", match: ["com.ptc.vuforia.engine"] },
      { name: "OpenVR", match: ["steamvr", "com.valvesoftware.unity.openvr"] },
      { name: "A-Frame", match: ["aframe"] },
      { name: "Augmented Reality", zh: "增强现实", match: ["ar"] },
      { name: "Virtual Reality", zh: "虚拟现实", match: ["vr"] },
      { name: "Mixed Reality", zh: "混合现实" },
    ],
  },
  engines: {
    zh: "引擎与交互",
    en: "Engines & Interaction",
    techs: [
      { name: "Unity", match: ["unity3d"] },
      { name: "Unreal Engine", match: ["unreal", "ue5"] },
      { name: "Godot", match: ["gdscript"] },
      { name: "ECS", match: ["entity-component-system", "entt", "flecs"] },
      { name: "Collision Detection", zh: "碰撞检测" },
      "Box2D",
      { name: "Bullet Physics", match: ["bullet", "bullet3", "pybullet"] },
      "PhysX",
      { name: "Jolt Physics", match: ["jolt", "joltphysics"] },
      "raylib", "SFML",
    ],
  },
  perception: {
    zh: "视觉与感知",
    en: "Vision & Perception",
    techs: [
      { name: "OpenCV", match: ["opencv-*", "opencv4"] },
      { name: "Camera Calibration", zh: "相机标定" },
      { name: "Pose Estimation", zh: "位姿估计" },
      { name: "Feature Detection", zh: "特征检测", match: ["feature-matching", "corner-detection", "harris-corner-detection"] },
      { name: "SLAM", match: ["vslam", "visual-slam", "orb-slam*", "orbslam*"] },
      { name: "Hand Tracking", zh: "手部追踪", match: ["com.unity.xr.hands"] },
      "MediaPipe",
      { name: "YOLO", match: ["yolo*", "ultralytics"] },
      { name: "CNN", match: ["convolutional-neural-networks"] },
      "DETR", "Open3D",
      { name: "PCL", match: ["point-cloud-library"] },
    ],
  },
  rendering: {
    zh: "图形渲染",
    en: "Rendering",
    techs: [
      { name: "OpenGL", match: ["glad", "glew", "gl3w", "pyopengl", "moderngl"] },
      { name: "Vulkan", match: ["volk", "vk-bootstrap"] },
      { name: "Metal", match: ["metal-cpp", "metalkit"] },
      { name: "DirectX", match: ["direct3d", "d3d11", "d3d12"] },
      "WebGL",
      { name: "WebGPU", match: ["wgpu"] },
      { name: "Three.js", match: ["three", "threejs"] },
      { name: "Shaders", zh: "Shader", match: ["shader"] },
      { name: "Ray Tracing", zh: "光线追踪", match: ["raytracing", "ray-tracer", "raytracer"] },
      { name: "Path Tracing", zh: "路径追踪", match: ["pathtracing", "path-tracer", "pathtracer"] },
      { name: "KD-Tree", match: ["kdtree"] },
      { name: "BVH", match: ["bounding-volume-hierarchy"] },
      { name: "GLFW", match: ["glfw3"] },
      { name: "SDL", match: ["sdl2", "sdl3"] },
      "GLM",
      { name: "Dear ImGui", match: ["imgui"] },
      "Assimp",
    ],
  },
  ai: {
    zh: "AI 应用",
    en: "Applied AI",
    techs: [
      { name: "PyTorch", match: ["torch", "torchvision"] },
      { name: "TensorFlow", match: ["tensorflow-*"] },
      { name: "scikit-learn", match: ["sklearn"] },
      { name: "Hugging Face", match: ["transformers", "diffusers", "huggingface-hub"] },
      { name: "LangChain", match: ["langchain-*", "@langchain/*"] },
      { name: "LangGraph", match: ["langgraph-*", "@langchain/langgraph"] },
      { name: "LlamaIndex", match: ["llama-index", "llama-index-*"] },
      { name: "MCP", match: ["@modelcontextprotocol/sdk", "fastmcp"] },
      { name: "OpenAI API", match: ["openai", "langchain-openai"] },
      { name: "Claude API", match: ["anthropic", "@anthropic-ai/sdk", "langchain-anthropic", "claude-agent-sdk"] },
      { name: "Gemini API", match: ["google-genai", "google-generativeai", "langchain-google-genai", "@google/genai"] },
      { name: "Ollama", match: ["langchain-ollama"] },
      { name: "Pinecone", match: ["pinecone-client", "@pinecone-database/pinecone"] },
      { name: "Chroma", match: ["chromadb"] },
      { name: "FAISS", match: ["faiss-cpu", "faiss-gpu"] },
      "RAG", "Gradio", "Streamlit",
    ],
  },
  web: {
    zh: "Web",
    en: "Web",
    techs: [
      "React",
      { name: "Next.js", match: ["next", "nextjs"] },
      { name: "Vue", match: ["vuejs"] },
      { name: "Svelte", match: ["@sveltejs/kit"] },
      { name: "Angular", match: ["@angular/core"] },
      { name: "Node.js", match: ["nodejs"] },
      "Express",
      { name: "NestJS", match: ["@nestjs/core"] },
      "FastAPI", "Flask", "Django",
      { name: "Tailwind CSS", match: ["tailwindcss", "@tailwindcss/*"] },
      "GraphQL",
      { name: "PostgreSQL", match: ["postgres", "pg", "psycopg", "psycopg2", "psycopg2-binary", "asyncpg"] },
      { name: "MySQL", match: ["mysql2", "pymysql", "mysqlclient"] },
      { name: "MongoDB", match: ["mongoose", "pymongo"] },
      { name: "SQLite", match: ["sqlite3", "better-sqlite3"] },
      { name: "Redis", match: ["ioredis"] },
    ],
  },
  // 几乎每个项目都用得上，不据此给项目分类
  systems: {
    zh: "系统与工具",
    en: "Systems & Tools",
    techs: [
      "Linux",
      { name: "Distributed Systems", zh: "分布式系统" },
      { name: "Embedded Systems", zh: "嵌入式系统", match: ["embedded"] },
      { name: "RTOS", match: ["freertos"] },
      "OpenMP",
      { name: "gRPC", match: ["grpcio", "@grpc/grpc-js"] },
      { name: "Kafka", match: ["apache-kafka", "kafka-python", "confluent-kafka", "kafkajs"] },
      "Boost",
      { name: "Docker", match: ["dockerfile"] },
      "CMake", "GitHub Actions", "pytest",
      { name: "GoogleTest", match: ["gtest", "gmock"] },
      "Catch2", "Jest", "Vitest",
    ],
  },
} satisfies Record<string, Record<Locale, string> & { techs: Tech[] }>;

export type SkillGroupId = keyof typeof groups;
const groupIds = Object.keys(groups) as SkillGroupId[];

// 比较写法时不分大小写，空格、点、下划线和连字符都算一样，如 ruamel.yaml / ruamel_yaml、Tailwind CSS / tailwind-css
const norm = (s: string) => s.toLowerCase().replace(/[\s._-]+/g, "-");

const techs = groupIds.flatMap((group) =>
  (groups[group].techs as Tech[]).map((t) => {
    const { name, zh = name, match = [] }: Exclude<Tech, string> = typeof t === "string" ? { name: t } : t;
    return { group, label: { zh, en: name } as Record<Locale, string>, keys: [name, zh, ...match].map(norm) };
  }),
);

// 一个项目用到的技术，按表里的顺序。signals 是仓库的语言、topics 和依赖
function detect(signals: string[]) {
  const have = signals.map(norm);
  const found = (key: string) =>
    key.endsWith("*") ? have.some((s) => s.startsWith(key.slice(0, -1))) : have.includes(key);
  return techs.filter((t) => t.keys.some(found));
}

// 项目页上显示的技术栈（页面语言的名字）
export const stackOf = (locale: Locale, signals: string[]) => detect(signals).map((t) => t.label[locale]);

// 项目用到的技术分属哪些分组，projects.ts 据此推断项目分类
export const stackGroupsOf = (signals: string[]) => new Set(detect(signals).map((t) => t.group));

// 关于页的技能：每组先列 profile.ts 里手写的，再补上项目用到、手写里还没有的技术（写在哪一组都算有）。
// 没有技能的分组不显示
export function skillsOf(
  locale: Locale,
  own: Partial<Record<SkillGroupId, string[]>>,
  projects: { stack: string[] }[],
) {
  const used = new Set(projects.flatMap((p) => p.stack));
  const written = new Set(Object.values(own).flatMap((list) => list ?? []).map(norm));
  return groupIds
    .map((id) => ({
      id,
      label: groups[id][locale],
      skills: [
        ...(own[id] ?? []),
        ...techs
          .filter((t) => t.group === id && used.has(t.label[locale]) && !t.keys.some((k) => written.has(k)))
          .map((t) => t.label[locale]),
      ],
    }))
    .filter((group) => group.skills.length > 0);
}
