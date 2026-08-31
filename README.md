# translate-plugin-for-chrome

一个基于 OpenAI-compatible API 的 Chrome 英文转中文翻译插件。

## 安装

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本项目目录。
4. 点击扩展详情中的“扩展程序选项”。

## 配置

填写以下三项并保存：

- `Base URL`：OpenAI-compatible API 的版本根地址，例如 `https://api.openai.com/v1`。
- `Token`：API 访问令牌。
- `Model`：模型名称，例如服务商提供的模型标识。

Token 只保存在 Chrome 的 `storage.local` 中，由后台 Service Worker 读取，不会注入网页内容。

## 使用

在任意普通 HTTP/HTTPS 网页中选中包含英文字母的文本，插件会自动请求配置的大模型 API，并在选区附近显示中文译文。点击浮层外的页面区域即可关闭浮层。

首版不处理 Chrome 内部页面、Chrome Web Store、`input`/`textarea` 选区，也不提供流式输出和翻译历史。

## License

[MIT](LICENSE)
