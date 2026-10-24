// 站点上的个人内容和界面文案都在这个文件里，改这里即可，页面代码不用动。
// 项目列表从 GitHub 自动获取，见 scripts/fetch-github.mjs 和 src/data/projects.ts。
// 两种语言共用的信息（邮箱、链接、标签）写在 shared，需要翻译的写在 zh / en 里。

import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "@/i18n";

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
  tagline: "五年软件开发经验，主攻 C++、游戏引擎架构与计算机图形学，熟悉 ECS 架构和碰撞检测。",
  about: [
    "我是曹宇，有五年软件开发经验，主攻 C++、游戏引擎架构与计算机图形学，熟悉 ECS 架构和碰撞检测。我习惯把复杂需求拆成可以独立验证的模块，一个人走完方案设计、编码、调试到性能优化的全过程：在 Arcane Survival 中，我用 Flow Field 让 200+ 个敌人稳定运行在 240 FPS。",
    "我上手新技术栈很快：本科读的是英语文学，转行后先后做过华为的分布式中间件、初创公司的 SaaS 后端和苏交科的 BIM 3D 工程软件，每次都能很快接手。我重视代码规范和工程化，在苏交科主导制定了团队的 C# 规范和代码审查流程，组件复用率因此提升了 30%。",
    "现在我在 Northeastern University 读计算机科学硕士，希望继续深耕图形渲染与游戏引擎方向。",
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
    projectsIntro: "我在 GitHub 上的公开项目，按最近更新排序，每天自动同步。",
    noDescription: "这个仓库还没有简介。",
    noProjects: "GitHub 上暂时还没有公开项目。",
    updated: "更新于",
    created: "创建于",
    stars: "Star",
    forks: "Fork",
    license: "许可证",
    languages: "语言构成",
    topics: "主题",
    details: "仓库信息",
    viewOnGithub: "GitHub 仓库",
    liveDemo: "在线演示",
    demoVideo: "演示视频",
    readme: "项目说明",
    noReadme: "这个仓库还没有 README。",
    backToProjects: "← 全部项目",
    prevProject: "上一个",
    nextProject: "下一个",
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
  tagline: "Five years of software engineering, focused on C++, game engine architecture, and computer graphics — with hands-on ECS and collision detection.",
  about: [
    "I'm Yu Cao, a software engineer with five years of experience, focused on C++, game engine architecture, and computer graphics, with hands-on work in ECS and collision detection. I break complex requirements into modules I can verify independently, and own the whole path from design and implementation to debugging and performance tuning — in Arcane Survival, a flow field keeps 200+ enemies running at a steady 240 FPS.",
    "I pick up new stacks quickly. I studied English Literature, then moved into software and worked on distributed middleware at Huawei, a SaaS backend at a startup, and BIM 3D engineering software at JSTI Group, ramping up fast each time. I care about code standards and engineering discipline: at JSTI I led the team's C# coding standards and review process, raising component reuse by 30%.",
    "I'm now pursuing an M.S. in Computer Science at Northeastern University, and plan to keep going deep on rendering and game engines.",
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
    projectsIntro: "My public projects on GitHub, most recently updated first. Synced daily.",
    noDescription: "No description yet.",
    noProjects: "No public projects on GitHub yet.",
    updated: "Updated",
    created: "Created",
    stars: "Stars",
    forks: "Forks",
    license: "License",
    languages: "Languages",
    topics: "Topics",
    details: "Repository",
    viewOnGithub: "GitHub repo",
    liveDemo: "Live demo",
    demoVideo: "Demo video",
    readme: "README",
    noReadme: "This repository has no README yet.",
    backToProjects: "← All projects",
    prevProject: "Previous",
    nextProject: "Next",
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
