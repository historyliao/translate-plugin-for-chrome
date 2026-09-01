# translate-plugin-for-chrome

一个基于 OpenAI-compatible API 的 Chrome 英文转中文翻译插件。

## 安装

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目目录。
4. 点击扩展详情中的“扩展程序选项”。

## 配置

填写翻译服务配置并保存：

- `Base URL`：OpenAI-compatible API 的版本根地址，例如 `https://api.openai.com/v1`。
- `Token`：API 访问令牌。
- `Model`：模型名称，例如服务商提供的模型标识。
- `启用流式响应`：可选，默认关闭；开启后译文会随模型输出逐步显示，API 服务需支持 Chat Completions SSE 响应。

Token 只保存在 Chrome 的 `storage.local` 中，由后台 Service Worker 读取，不会注入网页内容。

## 使用

在任意普通 HTTP/HTTPS 网页中选中包含英文字母的文本，插件会自动请求配置的大模型 API，并在选区附近显示中文译文。点击浮层外的页面区域即可关闭浮层。

点击浏览器工具栏中的插件图标打开控制面板，可全局开启或关闭翻译：

- 绿色 `ON`：选择英文时自动翻译。
- 灰色 `OFF`：选择文本时不调用 API，不消耗翻译 Token。

关闭翻译会立即取消正在进行的请求并关闭翻译浮层。重新开启后，已打开的网页无需刷新即可继续使用。需要修改 API 配置时，点击控制面板中的“打开设置”。

插件不处理 Chrome 内部页面、Chrome Web Store、`input`/`textarea` 选区，也不提供翻译历史。

## 升级插件

如果插件目录是通过 Git 克隆的，在项目目录中更新代码：

```bash
git switch main
git pull --ff-only origin main
```

然后打开 `chrome://extensions`，找到本插件并点击“重新加载”。最后刷新已经打开的网页，使新版内容脚本生效。保存在 Chrome `storage.local` 中的翻译服务配置会继续保留。

如果插件目录不是 Git 仓库，请用新版本文件完整覆盖原目录，再到 `chrome://extensions` 中重新加载插件。插件加载期间不要删除或移动该目录。

## License

[MIT](LICENSE)
