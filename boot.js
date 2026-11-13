/*
 * boot.js — 首帧引导：开屏两态 + 首帧主题（只在 <head> 里以阻塞脚本加载）。
 * --------------------------------------------------------------------------
 * 为什么必须在 <head> 同步执行、且必须在页面结构之前：
 *   - 开屏入场的两态（见 CSS 里的「落纸」）：booting = 「骨架先说：我要入场了」，
 *     晚一帧执行就会先看见内容再跳一下；
 *   - 看门狗是必需的：脚本万一没跑到标记就绪（报错、或这页被当静态文件打开），
 *     也得自己放行——开屏出问题是小事，页面空白是大事；
 *   - 暗色在渲染前定好（跟随系统，显式切换后以存储为准），否则首屏会先闪一下亮色。
 *
 * 从 index.html 拆出来的理由：它是「首帧的执行」而不是页面结构，放独立文件之后，
 * 结构那一份只剩 markup，加页面片段不必再跟这段引导脚本抢预算。
 */
// 开屏入场的两态：booting 先落，ready 由启动流程在 renderAll 之后翻转。
document.documentElement.classList.add('booting');
setTimeout(function () { document.documentElement.classList.add('ready'); }, 1500);
(function () {
  var stored = localStorage.getItem('dark-mode');
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (stored === '1' || (stored === null && systemDark)) document.documentElement.classList.add('dark');
})();
