// 站点上所有个人内容和界面文案都在这个文件里，改这里即可，页面代码不用动。
// 两种语言共用的信息（邮箱、链接、标签）写在 shared，需要翻译的写在 zh / en 里。

import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "@/i18n";

export type Project = {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  year: string;
  featured?: boolean;
  links?: { label: string; href: string }[];
};

export type Experience = {
  period: string;
  role: string;
  org: string;
  points: string[];
};

const shared = {
  email: "cao.y2@northeastern.edu",
  links: [
    { label: "GitHub", href: "https://github.com/ZJUCao" },
    { label: "LinkedIn", href: "https://www.linkedin.com/in/yu-cao-19026238a/" },
  ],
  location: "Boston, MA",
};

const zh = {
  name: "曹宇",
  title: "软件工程师",
  tagline: "五年工业界开发经验，从华为的分布式中间件到 3D 工程软件；现在专注图形渲染、游戏引擎与计算机视觉。",
  about: [
    "我本科在浙江大学读英语文学，选修编程课时喜欢上了写代码，毕业后进入华为杭州研究所做全栈开发，之后在初创公司搭建 SaaS 后端，又在苏交科集团做了三年 BIM 3D 工程软件开发。",
    "现在我在 Northeastern University 读计算机科学硕士，课程和项目集中在计算机图形学、游戏引擎和计算机视觉：写过 KD-Tree 加速的光线追踪渲染器、基于 ECS 的游戏，也做过实时目标检测应用。",
  ],
  skills: {
    编程语言: ["C/C++", "C#", "Java", "Python", "JavaScript", "Lua", "GLSL"],
    图形与引擎: ["OpenGL", "Shader", "光线追踪", "KD-Tree", "ECS"],
    计算机视觉: ["OpenCV", "YOLO", "CNN", "DETR", "相机标定"],
    系统: ["Linux", "分布式系统", "嵌入式系统", "RTOS"],
    Web: ["React", "Node.js", "PostgreSQL", "MongoDB", "SQLite"],
    工具: ["Git", "Docker", "Claude Code", "Ollama"],
  } as Record<string, string[]>,
  work: [
    {
      period: "2022.04 — 2025.07",
      role: "BIM 软件开发工程师",
      org: "苏交科集团股份有限公司 · 南京",
      points: [
        "基于 Bentley 平台完成 BIM 3D 工程软件的全栈开发，设计并实现「导线法」和「线元法」两大核心算法模块",
        "主导制定部门 C# 代码规范与代码审查流程，组件复用率提升 30%",
        "负责「云基」平台的需求设计与端到端开发，交付横断面生成、3D 建模及材料库模块",
      ],
    },
    {
      period: "2021.10 — 2022.03",
      role: "后端开发工程师",
      org: "北京获客多科技有限公司（初创公司）· 北京",
      points: [
        "从零搭建 SaaS 核心后端（Node.js），按需参与前端开发（React）",
        "交付 20+ CRM / ERP 业务 API，通过监控告警与自动化测试保障 99.9%+ 可用性",
      ],
    },
    {
      period: "2020.07 — 2021.10",
      role: "全栈软件开发工程师",
      org: "华为技术有限公司杭州研究所 · 杭州",
      points: [
        "参与高性能分布式消息中间件核心模块开发，通过内存池与内存对齐优化高并发吞吐",
        "主导 4 个开源组件（Redis Trie Tree、TinyXML、LibXML、MD5）的内源化改造；Trie Tree 获「华为代码英雄奖」（前 20 / 10000+）",
        "联合土耳其研究所（8 人团队）完成 LibXML 重构，建立测试覆盖率 >95% + 静态检查门禁的交付体系",
      ],
    },
  ] as Experience[],
  education: [
    {
      period: "2025.09 — 2027.05",
      role: "计算机科学硕士",
      org: "Northeastern University · 波士顿",
      points: ["GPA 3.93/4.0，专业排名前 5%", "核心课程：计算机图形学 (A)、模式识别与计算机视觉 (A)、算法 (A)、游戏引擎开发 (A)"],
    },
    {
      period: "2016.09 — 2020.06",
      role: "英语文学学士",
      org: "浙江大学 · 杭州",
      points: ["计算机选修：C 程序设计 (5.0/5.0)、Python 程序设计 (5.0/5.0)、面向对象程序设计 (4.5/5.0)"],
    },
  ] as Experience[],
  projects: [
    {
      slug: "arcane-survival",
      title: "Arcane Survival",
      summary:
        "游戏引擎课程项目。基于 ECS 架构拆分生成、索敌、移动、碰撞四个系统；用 Reverse DFS 驱动的 Flow Field 调度 200+ 追猎敌人，帧率稳定在 240 FPS；JSON / Lua 数据驱动配置，玩法参数无需重新编译即可调整。",
      tags: ["ECS", "Flow Field", "Lua", "Game Engine"],
      year: "2026",
      featured: true,
    },
    {
      slug: "nutriscan",
      title: "NutriScan 实时营养追踪",
      summary:
        "计算机视觉课程项目。摄像头采集 → YOLO 目标检测 → 营养数据库匹配 → UI 渲染的端到端实时系统；升级到 YOLOv8s 并重新设计跨类别 NMS 与时序平滑，mAP 从 0.711 提升到 0.871，保持 30 FPS。",
      tags: ["Python", "YOLOv8", "OpenCV"],
      year: "2026",
      featured: true,
    },
    {
      slug: "ray-tracer",
      title: "光线追踪渲染器",
      summary:
        "计算机图形学课程项目。离线 CPU 光线追踪渲染器，用 KD-Tree 空间加速结构加包围盒剪枝，把射线-图元求交从 O(n) 降到 O(log n)，渲染性能提升 100 倍以上。",
      tags: ["C++", "Ray Tracing", "KD-Tree"],
      year: "2025",
      featured: true,
    },
    {
      slug: "job-assistant",
      title: "求职助手",
      summary:
        "一组完全在本机运行的求职 Agent：按岗位 JD 优化简历，并从多个来源找岗位、和个人经历做匹配。个人数据不出本机，测试禁止访问外网。",
      tags: ["Python", "LLM Agent", "Ollama", "LaTeX"],
      year: "2026",
    },
    {
      slug: "portfolio",
      title: "个人作品集",
      summary: "就是这个网站。Next.js 静态导出，中英双语，Tailwind CSS 排版，Motion 做滚动动效，部署在 Vercel。",
      tags: ["Next.js", "TypeScript", "Tailwind CSS", "i18n"],
      year: "2026",
    },
  ] as Project[],
  ui: {
    nav: { projects: "项目", about: "关于", contact: "联系" },
    switchLabel: "EN",
    switchAria: "Switch to English",
    hello: (name: string) => `你好，我是${name}。`,
    ctaProjects: "看看我的项目",
    ctaContact: "联系我",
    featured: "精选项目",
    viewAll: "全部 →",
    projectsTitle: "项目",
    projectsIntro: "我做过的一些东西，按时间倒序。",
    aboutTitle: "关于我",
    workTitle: "工作经历",
    educationTitle: "教育经历",
    skillsTitle: "技能",
    contactTitle: "联系我",
    contactIntro: "工作机会、项目合作，或者只是想聊聊，都欢迎发邮件给我。",
  },
};

const en: typeof zh = {
  name: "Yu Cao",
  title: "Software Engineer",
  tagline: "Five years of industry experience, from distributed middleware at Huawei to 3D engineering software. Now focused on graphics, game engines, and computer vision.",
  about: [
    "I studied English Literature at Zhejiang University and fell for programming in my CS electives. After graduating I joined Huawei's Hangzhou Research Institute as a full-stack engineer, built a SaaS backend from scratch at a startup, then spent three years developing BIM 3D engineering software at JSTI Group.",
    "I'm now pursuing an M.S. in Computer Science at Northeastern University, focused on computer graphics, game engines, and computer vision — a KD-Tree-accelerated ray tracer, an ECS-based game, and a real-time object detection app.",
  ],
  skills: {
    Languages: ["C/C++", "C#", "Java", "Python", "JavaScript", "Lua", "GLSL"],
    "Graphics & Engines": ["OpenGL", "Shaders", "Ray Tracing", "KD-Tree", "ECS"],
    "Computer Vision": ["OpenCV", "YOLO", "CNN", "DETR", "Camera Calibration"],
    Systems: ["Linux", "Distributed Systems", "Embedded Systems", "RTOS"],
    Web: ["React", "Node.js", "PostgreSQL", "MongoDB", "SQLite"],
    Tools: ["Git", "Docker", "Claude Code", "Ollama"],
  },
  work: [
    {
      period: "04/2022 — 07/2025",
      role: "BIM Software Development Engineer",
      org: "JSTI Group · Nanjing",
      points: [
        "Full-stack development of 3D engineering software on the Bentley platform, including the core Traverse Method and Linear Element Method modules",
        "Established team C# coding standards and review workflows, raising code reuse by 30%",
        "Owned requirements through delivery for the Yunji platform: cross-section generation, 3D solid modeling, and a material library",
      ],
    },
    {
      period: "10/2021 — 03/2022",
      role: "Backend Development Engineer",
      org: "Beijing Hokdo Technology (Startup) · Beijing",
      points: [
        "Built and owned the core SaaS backend in Node.js, contributing to the React frontend as needed",
        "Delivered 20+ CRM/ERP APIs at 99.9%+ availability through monitoring, graceful degradation, and automated testing",
      ],
    },
    {
      period: "07/2020 — 10/2021",
      role: "Full-Stack Software Engineer",
      org: "Huawei Technologies · Hangzhou",
      points: [
        "Developed core modules of distributed message middleware, tuning high-concurrency throughput with memory pools and cache-line alignment",
        "Led internalization of 4 open-source components (Redis Trie Tree, TinyXML, LibXML, MD5) for embedded systems; the Trie Tree won the Huawei Code Hero Award (top 20 of 10,000+)",
        "Partnered with the Turkey Research Institute (8-person team) to refactor LibXML, with >95% unit test coverage and static-check gates",
      ],
    },
  ],
  education: [
    {
      period: "09/2025 — 05/2027",
      role: "M.S. in Computer Science",
      org: "Northeastern University · Boston, MA",
      points: [
        "GPA 3.93/4.0",
        "Coursework: Computer Graphics (A), Pattern Recognition & Computer Vision (A), Algorithms (A), Building Game Engines (A)",
      ],
    },
    {
      period: "09/2016 — 06/2020",
      role: "B.A. in English Literature",
      org: "Zhejiang University · Hangzhou",
      points: ["CS electives: C Programming (5.0/5.0), Python Programming (5.0/5.0), Object-Oriented Programming (4.5/5.0)"],
    },
  ],
  projects: [
    {
      slug: "arcane-survival",
      title: "Arcane Survival",
      summary:
        "Game engine course project. Gameplay built on an ECS split into spawning, targeting, movement, and collision systems; a Reverse-DFS-driven flow field routes 200+ chasing enemies at a stable 240 FPS; JSON/Lua data-driven config lets gameplay change without recompiling.",
      tags: ["ECS", "Flow Field", "Lua", "Game Engine"],
      year: "2026",
      featured: true,
    },
    {
      slug: "nutriscan",
      title: "NutriScan",
      summary:
        "Computer vision course project. A real-time pipeline from camera capture to YOLO detection, nutrition lookup, and UI; upgrading to YOLOv8s with redesigned cross-class NMS and temporal smoothing raised mAP from 0.711 to 0.871 at 30 FPS.",
      tags: ["Python", "YOLOv8", "OpenCV"],
      year: "2026",
      featured: true,
    },
    {
      slug: "ray-tracer",
      title: "Ray Tracer",
      summary:
        "Computer graphics course project. An offline CPU ray tracer whose KD-Tree acceleration structure with bounding-box pruning cuts ray–primitive intersection from O(n) to O(log n), speeding up rendering by more than 100x.",
      tags: ["C++", "Ray Tracing", "KD-Tree"],
      year: "2025",
      featured: true,
    },
    {
      slug: "job-assistant",
      title: "Job Assistant",
      summary:
        "A set of job-search agents that run entirely on-device: tailoring résumés to a job description, and sourcing roles from several sites to match against my experience. Personal data never leaves the machine; tests are blocked from the network.",
      tags: ["Python", "LLM Agent", "Ollama", "LaTeX"],
      year: "2026",
    },
    {
      slug: "portfolio",
      title: "Portfolio",
      summary: "This site. A bilingual Next.js static export, styled with Tailwind CSS, animated with Motion, deployed on Vercel.",
      tags: ["Next.js", "TypeScript", "Tailwind CSS", "i18n"],
      year: "2026",
    },
  ],
  ui: {
    nav: { projects: "Projects", about: "About", contact: "Contact" },
    switchLabel: "中文",
    switchAria: "切换到中文",
    hello: (name: string) => `Hi, I'm ${name}.`,
    ctaProjects: "See my work",
    ctaContact: "Get in touch",
    featured: "Featured projects",
    viewAll: "All →",
    projectsTitle: "Projects",
    projectsIntro: "Things I've built, newest first.",
    aboutTitle: "About me",
    workTitle: "Work Experience",
    educationTitle: "Education",
    skillsTitle: "Skills",
    contactTitle: "Get in touch",
    contactIntro: "Job opportunities, collaborations, or just a chat — my inbox is open.",
  },
};

const content = { zh, en } satisfies Record<Locale, typeof zh>;

export const getContent = (locale: Locale) => ({ locale, ...shared, ...content[locale] });
export type Content = ReturnType<typeof getContent>;

// 页面拿到的 lang 路由参数是 string，不在支持列表里就返回 404
export function contentFor(lang: string) {
  if (!hasLocale(lang)) notFound();
  return getContent(lang);
}
