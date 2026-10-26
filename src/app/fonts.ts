import { Geist, Geist_Mono } from "next/font/google";

// 全站只用 Geist 一种字体；Geist Mono 只用在一直在跳的数字上（首页 3D 画面的帧率、位姿）和代码里。
// 两个根布局和全局 404 页共用这里的字体
export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
