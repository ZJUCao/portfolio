// 在 React 接管页面之前运行（Next 的 instrumentation-client 约定）。
// 浏览器的后退、前进进出项目详情页时，封面也放大缩小（docs/design_space_cut.md §13 P5）。Next 处理后退、前进时不带
// 过渡类型，它自己的还原也不会单独作为 Transition 提交，所以要在它之前另起一个带 COVER_TYPE、带一次更新的 Transition，
// React 会把两者一起提交。监听器在这里注册，一定排在 Next 的前面（Next 的要等页面接管以后才注册），切换语言、
// 根布局重新挂载也不会改变先后
import { addTransitionType, startTransition } from "react";
import { traversal } from "@/cut/coverHistory";
import { COVER_TYPE } from "@/cut/coverMorph";

window.addEventListener("popstate", () => {
  const update = traversal(window.location.pathname);
  if (!update) return;
  startTransition(() => {
    addTransitionType(COVER_TYPE);
    update();
  });
});
