# Daily Translate 品牌与图标设计

## 目标

将插件品牌统一为 `Daily Translate（每日翻译）`，让名称直接包含翻译关键词，并通过简洁图标传达“翻译”和“对话”含义。品牌调整不改变任何翻译功能或配置数据。

## 品牌文案

- 英文名：`Daily Translate`
- 中文名：`每日翻译`
- 完整名称：`Daily Translate - AI 划词翻译`
- 标语：`选中即译，模型由你`

Manifest 使用完整名称，`short_name` 使用英文名，工具栏提示和 Popup 使用中文名。README 同时展示中英文名，并继续突出简单、开放、可自定义模型。

## 图标

图标由两个元素组成：

- 蓝色至靛蓝色的圆角对话框，右下角带一个小尾巴；
- 对话框中央使用白色、粗笔画、圆角的几何字母 `T`，表示 Translate。

不使用日光圆点、字母 `D`、箭头、星光、完整文字或阴影。对话框和 `T` 保持较大留白，确保工具栏中的 16px 图标仍可辨认。

保留 `icons/icon.svg` 作为矢量源文件，并提供 Chrome Manifest 使用的 16、32、48、128px PNG。16px 版本使用纯蓝背景，减少缩小时的颜色干扰；其他尺寸使用轻微的蓝靛渐变。

## 界面与文件范围

- `manifest.json`：更新名称、描述、工具栏提示和图标声明。
- `background/service-worker.js`：在动态工具栏状态提示中保留品牌名。
- `popup/popup.html`、`popup/popup.css`：显示品牌图标、中文名和标语。
- `options/options.html`：将页面标题统一为“每日翻译设置”。
- `README.md`：更新项目标题和首屏简介。
- `icons/`：新增 SVG 源文件和四种 PNG 尺寸。

除工具栏状态文案外，不修改 Service Worker；不修改 Content Script、设置存储结构、权限或 API 请求行为。

## 验证

- Manifest 可被 JSON 解析，所有声明的图标文件存在。
- PNG 文件尺寸分别为 16、32、48、128px，使用 RGBA 格式并保留透明背景。
- SVG 可被 XML 解析。
- 所有 JavaScript 文件通过 `node --check`。
- `git diff --check` 通过，且变更不包含 `.superpowers/`。
