/*
 * tailwind-config.js — Tailwind CDN 的主题扩展（只在 <head> 里、紧跟 CDN 脚本之后加载）。
 * --------------------------------------------------------------------------
 * 顺序不能换：先有 cdn.tailwindcss.com 定义 window.tailwind，这里才赋得上 config。
 * 它只给 CDN 工具类调色；页面自有 CSS 的 token 在 styles.css，两者不互为来源。
 */
tailwind.config = {
  theme: {
    extend: {
      // 排版规格（字号/字重/字体族）一律写在自有 CSS 的 :root, :root.dark token 与 .t-* 档位类里，
      // 不在这里声明 fontFamily：CDN 拉不到时这些类不生效，真机里又会和自有档位各算一套。
      colors: {
        ink: { 50: '#f6f1e4', 100: '#ece4d0', 200: '#d8cbab', 300: '#b9a87e', 400: '#9a8758', 500: '#7c6b43', 600: '#5e5034', 700: '#473b28', 800: '#2f281b', 900: '#211b10', 950: '#15110a' },
        gold: { 300: '#e6c982', 400: '#d9b25e', 500: '#b4841a', 600: '#8f6713' },
        verdigris: { 400: '#7fc4a0', 500: '#2f6b4f' },
        paper: '#f6f1e4',
      }
    }
  }
}
