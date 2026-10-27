# 下拉弹层用 `appearance: base-select` 接管，不自研列表框

下拉弹层（picker）由系统绘制，页面拿不到它的底色——暖色纸面上会弹出一张纯白面板。
决定：给 `<select>` 与 `::picker(select)` 设 `appearance: base-select`，用现有 CSS 变量接管弹层的底色、描边、圆角与高亮；不支持的浏览器保持原状（规则被丢弃），HTML 一字不改。验收被闭合态的宽度跳动逼出了一小段 JS（见下面第三条代价），但弹层的上色本身仍是纯 CSS。

选它而不是自研 `div` 列表框：自研要重写 14 处 `onchange` 接线与全套键盘/焦点行为，
是这份单文件里最大的一块自造控件；而 `base-select` 是纯 CSS，HTML 一字不改。

代价（写在这里是因为它们看起来像 bug，其实是选择）：
- 只在 Chromium 生效；Firefox / Safari 仍是系统白面板。目标用户只用 Chrome，接受。
- select 不再按最长选项取宽：换选中项宽度在 160/186/214 之间跳（原生恒定 231）。
  `field-sizing: content` / `min-width: max-content` / `width: max-content` 三种写法实测全无效，
  故用 `--sel-w` 把固有宽度量一次钉住。这是本决策唯一带来的 JS 代码。
- 弹层里的 `option:hover` 会误伤选中项（一打开选中项就铺金），所以选中态只加粗、悬停态才铺色。
- 箭头仍是自绘 `--chevron`，`::picker-icon` 显式 `display: none`——两套机制并存是刻意的，
  不是漏删：`--chevron` 承载着「`background` 简写会吃掉 `background-image`」那条踩坑记录。

被否掉的路线：只给 `<option>` 写 `background/color`——Chromium 自 81 起忽略它，
在 Linux 上可能恰好生效，制造「测试绿了、用户机器上仍是白的」。
