// 站点上的个人内容和界面文案都在这个文件里，改这里即可，页面代码不用动。
// 项目列表从 GitHub 自动获取，见 scripts/fetch-github.mjs 和 src/data/projects.ts。
// 两种语言共用的信息（邮箱、链接、标签）写在 shared，需要翻译的写在 zh / en 里。

import { notFound } from "next/navigation";
import { hasLocale, type Locale } from "@/i18n";
import type { SkillGroupId } from "./skills";

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
  title: "C++ 图形与视觉工程师",
  // 网页的简介（meta description），搜索结果和分享卡片里显示
  tagline: "曹宇，五年软件开发经验，写过游戏引擎、OpenGL 渲染器和基于标定板的 AR，正在找 2027 年 XR 与图形方向的实习和全职工作。",
  about: [
    "我是曹宇，有五年软件开发经验，主攻 C++、游戏引擎架构与计算机图形学，熟悉 ECS 架构和碰撞检测。我习惯把复杂需求拆成可以独立验证的模块，一个人走完方案设计、编码、调试到性能优化的全过程：在 Arcane Survival 中，我用 Flow Field 让 200+ 个敌人稳定运行在 240 FPS。",
    "我上手新技术栈很快：本科读的是英语文学，转行后先后做过华为的分布式中间件、初创公司的 SaaS 后端和苏交科的 BIM 3D 工程软件，每次都能很快接手。我重视代码规范和工程化，在苏交科主导制定了团队的 C# 规范和代码审查流程，组件复用率因此提升了 30%。",
    "现在我在 Northeastern University 读计算机科学硕士，目标是 XR：渲染、视觉追踪和引擎这几块在这里会合到一起。",
  ],
  // 手写的技能，按分组写；分组的名字和顺序见 src/data/skills.ts。
  // 项目里用到的技术（如 GLFW、Next.js）会自动补到对应分组的末尾，这里只写从项目里看不出来的
  skills: {
    languages: ["C/C++", "C#", "Java", "Python", "JavaScript", "Lua", "GLSL"],
    xr: ["增强现实"],
    engines: ["ECS", "碰撞检测"],
    perception: ["OpenCV", "YOLO", "CNN", "DETR", "相机标定"],
    rendering: ["OpenGL", "Shader", "光线追踪", "KD 树"],
    web: ["React", "Node.js", "PostgreSQL", "MongoDB", "SQLite"],
    systems: ["Linux", "分布式系统", "嵌入式系统", "RTOS", "Git", "Docker", "Claude Code", "Ollama"],
  } as Partial<Record<SkillGroupId, string[]>>,
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
  // 首页按着陆页的顺序排：首屏、能带来什么、一句话的核心卖点、做事方法、精选项目、经历、常见问题、结尾的联系按钮。
  // 首屏和结尾只有一个主按钮：发邮件
  home: {
    headline: ["做 XR 渲染与追踪的", "C++ 工程师"], // 每一项单独占一行，按意思断开
    subheadline:
      "我是曹宇，做过五年软件开发，写过游戏引擎、OpenGL 渲染器和基于标定板的 AR。现在在 Northeastern 读计算机硕士，2027 年暑期实习和毕业后的全职都在找。",
    cta: "发邮件聊聊机会",
    proof: "华为代码英雄奖 · 前 20 / 10000+",
    benefitsTitle: "我能带给团队什么",
    benefits: [
      { title: "帧率稳得住", body: "在 Arcane Survival 里用 Flow Field 让 200 多个敌人稳定跑在 240 FPS。" },
      { title: "从零写渲染", body: "OpenGL 3.3 场景图渲染器，加上一个 CPU 光线追踪器：每个网格建一棵 KD 树，渲染最多快 150 倍。" },
      { title: "追踪对得准", body: "先用 OpenCV 标定相机，再把带光照的场景图稳稳叠在打印出来的棋盘格上。" },
      {
        title: "代码团队接得住",
        body: "在苏交科主导 C# 规范和代码审查，组件复用率提升 30%；在华为重构 LibXML 时，单元测试覆盖率超过 95%。",
      },
    ],
    // 大字的核心卖点，每一项一行，滚动时逐词亮起
    tagline: ["XR 的沉浸感，", "靠每一帧都准时、", "每一次追踪都对齐。", "这正是我写的那部分代码。"],
    stepsTitle: "我怎么做事",
    steps: [
      { title: "拆成能验证的模块", body: "先把复杂需求拆开，让每个模块都能单独测试、单独确认。" },
      { title: "先定指标再实现", body: "每个模块先定一个要达到的数字，比如帧时间、内存或复用率，写完就拿数据对照。" },
      { title: "调优到位再交接", body: "把热点路径调到达标，再留下测试和规范，团队可以直接接着做。" },
    ],
    recordTitle: "工作和学习经历",
    record: [
      { org: "华为", detail: "分布式消息中间件，华为代码英雄奖" },
      { org: "苏交科集团", detail: "BIM 3D 工程软件，主导 C# 规范" },
      { org: "Northeastern University", detail: "计算机科学硕士，GPA 3.93" },
      { org: "浙江大学", detail: "英语文学学士" },
    ],
    faqTitle: "常见问题",
    faq: [
      {
        q: "你在找什么样的职位？",
        a: "XR、图形渲染、游戏引擎和计算机视觉方向的工程岗位：2027 年暑期实习，以及 2027 年 5 月毕业后的全职。",
      },
      {
        q: "人在哪里？可以远程吗？",
        a: "我在波士顿。远程没问题；如果岗位必须到现场，我可以休学一个学期过去。全球各地的机会我都会考虑。",
      },
      { q: "什么时候可以开始？", a: "实习从 2027 年夏天开始，全职在 2027 年 5 月毕业之后。" },
      {
        q: "做过 XR 吗？",
        a: "做过基于标记的 AR：SceneGraph AR 用 OpenCV 标定相机，再用 OpenGL 把场景图对齐到棋盘格上。首页的 3D 场景就是照着它做的。",
      },
      { q: "最擅长哪一块？", a: "C++ 和引擎架构：ECS、碰撞检测、场景图，以及从 Phong 着色到光线追踪的渲染。" },
      { q: "能看看代码吗？", a: "可以。网站上的每个项目都是公开的 GitHub 仓库，每天自动同步到这里。" },
      {
        q: "平时用哪些语言和工具？",
        a: "C++、C#、Python 和 GLSL；图形用 OpenGL，视觉用 OpenCV 和 YOLO，构建用 CMake 和 Docker。",
      },
      {
        q: "团队协作经验怎么样？",
        a: "在华为和土耳其研究所的同事组成 8 人团队重构了 LibXML；在苏交科主导制定了部门的 C# 规范和代码审查流程。",
      },
    ],
    finalTitle: "在招 XR 或图形方向的工程师？",
    finalBody: "这里的每个项目都在 GitHub 上公开，聊之前可以先看代码。",
  },
  privacy: {
    title: "隐私说明",
    points: [
      "这个网站不使用 Cookie，也没有接入任何统计或广告服务。",
      "你在导航栏选择的语言保存在你自己浏览器的本地存储里，只用来下次打开时直接显示这个语言，不会发送给任何服务器。",
      "项目卡片和项目说明里的图片直接从 GitHub 加载；如果项目页嵌入了 YouTube 或 B 站的演示视频，播放器由对应平台提供。这些服务会像你访问其他网页时一样收到请求。",
      "网站托管在 Vercel 上，Vercel 会按它自己的隐私政策保留访问日志。",
    ],
  },
  ui: {
    nav: { projects: "项目", about: "关于", contact: "联系", openMenu: "打开菜单", closeMenu: "关闭菜单" },
    switchLabel: "EN",
    switchAria: "Switch to English",
    skip: "跳到正文",
    // 首页 3D 画面四周的 HUD 文字
    hud: {
      scene: "实时 3D 场景：棋盘格标定板上的一座场景图城堡，仿照我的 SceneGraph AR 项目",
      tracking: "追踪中",
      board: "标定板 9×6 · 54 个角点",
      hint: "移动鼠标，换个角度看",
      ar: "在 AR 中查看",
      vr: "在 VR 中查看",
    },
    featured: "精选项目",
    viewAll: "全部",
    projectsTitle: "项目",
    projectsIntro: "我在 GitHub 上的公开项目，按最近更新排序，每天自动同步。",
    allCategories: "全部",
    categoryFilter: "按分类筛选",
    noDescription: "这个仓库还没有简介。",
    coverAlt: (title: string) => `${title} 的截图`,
    noProjects: "GitHub 上暂时还没有公开项目。",
    updated: "更新于",
    created: "创建于",
    stars: "Star",
    forks: "Fork",
    license: "许可证",
    languages: "语言构成",
    stack: "技术栈",
    topics: "主题",
    details: "仓库信息",
    viewOnGithub: "GitHub 仓库",
    liveDemo: "在线演示",
    demoVideo: "演示视频",
    readme: "项目说明",
    noReadme: "这个仓库还没有 README。",
    readmeOtherLanguage: "这个项目暂时只有英文版说明。",
    backToProjects: "全部项目",
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
  title: "C++ graphics and vision engineer",
  tagline:
    "Yu Cao: five years of software engineering across game engines, an OpenGL renderer and marker based AR. Open to XR and graphics internships and full time roles in 2027.",
  about: [
    "I'm Yu Cao, a software engineer with five years of experience, focused on C++, game engine architecture, and computer graphics, with practical work in ECS and collision detection. I break complex requirements into modules I can verify independently, and own the whole path from design and implementation to debugging and performance tuning: in Arcane Survival, a flow field keeps 200+ enemies running at a steady 240 FPS.",
    "I pick up new stacks quickly. I studied English literature, then moved into software and worked on distributed middleware at Huawei, a SaaS backend at a startup, and BIM 3D engineering software at JSTI Group, ramping up fast each time. I care about code standards and engineering discipline: at JSTI I led the team's C# coding standards and review process, raising component reuse by 30%.",
    "I'm now finishing an M.S. in Computer Science at Northeastern University and aiming at XR, where rendering, vision tracking and engine work come together.",
  ],
  skills: {
    languages: ["C/C++", "C#", "Java", "Python", "JavaScript", "Lua", "GLSL"],
    xr: ["Augmented Reality"],
    engines: ["ECS", "Collision Detection"],
    perception: ["OpenCV", "YOLO", "CNN", "DETR", "Camera Calibration"],
    rendering: ["OpenGL", "Shaders", "Ray Tracing", "KD Tree"],
    web: ["React", "Node.js", "PostgreSQL", "MongoDB", "SQLite"],
    systems: ["Linux", "Distributed Systems", "Embedded Systems", "RTOS", "Git", "Docker", "Claude Code", "Ollama"],
  },
  work: [
    {
      period: "04/2022 — 07/2025",
      role: "BIM Software Development Engineer",
      org: "JSTI Group · Nanjing",
      points: [
        "Full stack development of 3D engineering software on the Bentley platform, including the core Traverse Method and Linear Element Method modules",
        "Established team C# coding standards and review workflows, raising code reuse by 30%",
        "Owned requirements through delivery for the Yunji platform: cross section generation, 3D solid modeling, and a material library",
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
      role: "Full Stack Software Engineer",
      org: "Huawei Technologies · Hangzhou",
      points: [
        "Developed core modules of distributed message middleware, tuning throughput under high concurrency with memory pools and cache line alignment",
        "Led internalization of 4 open source components (Redis Trie Tree, TinyXML, LibXML, MD5) for embedded systems; the Trie Tree won the Huawei Code Hero Award (top 20 of 10,000+)",
        "Partnered with the Turkey Research Institute (a team of eight) to refactor LibXML, with >95% unit test coverage and static analysis gates",
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
      points: ["CS electives: C Programming (5.0/5.0), Python Programming (5.0/5.0), Object Oriented Programming (4.5/5.0)"],
    },
  ],
  home: {
    headline: ["C++ engineer for", "XR rendering and tracking"],
    subheadline:
      "I'm Yu Cao: five years of software engineering across game engines, an OpenGL renderer and marker based AR. Now finishing an M.S. in Computer Science at Northeastern, open to summer 2027 internships and full time roles from May 2027.",
    cta: "Email me about a role",
    proof: "Huawei Code Hero Award · top 20 of 10,000+",
    benefitsTitle: "What I bring to your team",
    benefits: [
      { title: "Frame rates that hold", body: "A flow field keeps 200+ enemies at a steady 240 FPS in Arcane Survival." },
      {
        title: "Rendering from first principles",
        body: "An OpenGL 3.3 scene graph renderer and a CPU ray tracer whose per mesh KD tree renders up to 150× faster.",
      },
      {
        title: "Tracking that lines up",
        body: "OpenCV camera calibration feeds an AR view that keeps a lit scene graph aligned with a printed checkerboard.",
      },
      {
        title: "Code a team can take over",
        body: "Led the C# coding standards and review process at JSTI, raising component reuse by 30%, and refactored LibXML at Huawei with over 95% unit test coverage.",
      },
    ],
    tagline: ["Presence in XR comes from", "frames that arrive on time", "and tracking that stays aligned.", "That is the code I write."],
    stepsTitle: "How I work",
    steps: [
      {
        title: "Split it into parts I can verify",
        body: "I break a complex requirement into modules that can each be tested and confirmed on their own.",
      },
      {
        title: "Set the number, then build",
        body: "Every module gets a target first, such as frame time, memory or reuse, and the result is measured against it.",
      },
      {
        title: "Tune it, then hand it over",
        body: "I optimize the hot path until it meets the target, then leave tests and conventions the team can build on.",
      },
    ],
    recordTitle: "Where I've worked and studied",
    record: [
      { org: "Huawei", detail: "Distributed messaging middleware, Code Hero Award" },
      { org: "JSTI Group", detail: "BIM 3D engineering software, led C# standards" },
      { org: "Northeastern University", detail: "M.S. in Computer Science, GPA 3.93" },
      { org: "Zhejiang University", detail: "B.A. in English Literature" },
    ],
    faqTitle: "Questions recruiters ask",
    faq: [
      {
        q: "What roles are you looking for?",
        a: "Engineering roles in XR, rendering, game engines and computer vision: summer 2027 internships, and full time roles after I graduate in May 2027.",
      },
      {
        q: "Where are you based? Can you work remotely?",
        a: "I'm in Boston. Remote works well for me. If a role needs me on site, I can take a semester off for it, and I'm open to opportunities anywhere in the world.",
      },
      { q: "When can you start?", a: "Internships from summer 2027, and full time roles after I graduate in May 2027." },
      {
        q: "Have you built XR before?",
        a: "Yes, marker based AR: SceneGraph AR calibrates a camera with OpenCV and renders a scene graph aligned to a checkerboard in OpenGL. The 3D scene at the top of this page is modeled on it.",
      },
      {
        q: "What are you strongest at?",
        a: "C++ and engine architecture: ECS, collision detection and scene graphs, plus rendering from Phong shading to ray tracing.",
      },
      { q: "Can I see your code?", a: "Yes. Every project on this site is a public GitHub repository, synced here daily." },
      {
        q: "Which languages and tools do you use day to day?",
        a: "C++, C#, Python and GLSL; OpenGL for graphics, OpenCV and YOLO for vision, and CMake and Docker for builds.",
      },
      {
        q: "How do you work with a team?",
        a: "At Huawei I refactored LibXML in a team of eight with the Turkey Research Institute; at JSTI I led the C# coding standards and review process.",
      },
    ],
    finalTitle: "Hiring for XR or graphics?",
    finalBody: "Every project here is public on GitHub, so you can read the code before we talk.",
  },
  privacy: {
    title: "Privacy",
    points: [
      "This site sets no cookies and runs no analytics or advertising services.",
      "The language you pick in the navigation is saved in your own browser's local storage, only so the site opens in that language next time. It is never sent to a server.",
      "Images on project cards and pages load directly from GitHub. If a project page embeds a YouTube or Bilibili demo video, the player comes from that platform. These services receive the request just as they would on any other site.",
      "The site is hosted on Vercel, which keeps access logs under its own privacy policy.",
    ],
  },
  ui: {
    nav: { projects: "Projects", about: "About", contact: "Contact", openMenu: "Open menu", closeMenu: "Close menu" },
    switchLabel: "中文",
    switchAria: "切换到中文",
    skip: "Skip to content",
    hud: {
      scene: "Live 3D scene: a scene graph castle on a calibration checkerboard, modeled on my SceneGraph AR project",
      tracking: "Tracking",
      board: "Board 9×6 · 54 corners",
      hint: "Move the pointer to look around",
      ar: "View in AR",
      vr: "View in VR",
    },
    featured: "Featured projects",
    viewAll: "All",
    projectsTitle: "Projects",
    projectsIntro: "My public projects on GitHub, most recently updated first. Synced daily.",
    allCategories: "All",
    categoryFilter: "Filter by category",
    noDescription: "No description yet.",
    coverAlt: (title: string) => `Screenshot of ${title}`,
    noProjects: "No public projects on GitHub yet.",
    updated: "Updated",
    created: "Created",
    stars: "Stars",
    forks: "Forks",
    license: "License",
    languages: "Languages",
    stack: "Tech stack",
    topics: "Topics",
    details: "Repository",
    viewOnGithub: "GitHub repo",
    liveDemo: "Live demo",
    demoVideo: "Demo video",
    readme: "README",
    noReadme: "This repository has no README yet.",
    readmeOtherLanguage: "This README is only available in Chinese.",
    backToProjects: "All projects",
    prevProject: "Previous",
    nextProject: "Next",
    aboutTitle: "About me",
    workTitle: "Work experience",
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
