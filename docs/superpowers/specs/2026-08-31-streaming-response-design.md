# 流式响应设计

## 目标

为现有英文转中文 Chrome 插件增加可选的流式响应。用户可以在设置页切换响应模式，默认继续使用非流式响应。关闭翻译浮层或重新选择文本时，插件立即取消正在进行的 API 请求。

## 配置

设置页新增“启用流式响应”复选框，配置存储键为 `streamEnabled`。

- `streamEnabled` 为 `true` 时使用流式响应。
- `streamEnabled` 为 `false` 时使用非流式响应。
- 配置不存在时按 `false` 处理，保证已有用户升级后行为不变。
- 保存设置时与 `baseUrl`、`model` 一并保存。
- Token 的存储、回显和读取边界保持不变。

## 通信架构

内容脚本与 Service Worker 统一使用长连接 Port，不再使用一次性 `runtime.sendMessage`。

```text
content script
    |
    | runtime.connect("translation")
    | postMessage({ text })
    v
Service Worker
    |
    +-- 读取 baseUrl、token、model、streamEnabled
    |
    +-- streamEnabled=false
    |      POST stream:false
    |      解析 choices[0].message.content
    |      postMessage({ type: "chunk", content: 完整译文 })
    |      postMessage({ type: "done" })
    |
    +-- streamEnabled=true
           POST stream:true
           读取 response.body
           解析 SSE data 行
           读取 choices[0].delta.content
           postMessage({ type: "chunk", content: 增量文本 })
           遇到 [DONE]
           postMessage({ type: "done" })
```

每个 Port 只处理一次翻译任务。内容脚本收到消息后的行为如下：

- `chunk`：追加内容并实时刷新浮层。
- `done`：结束翻译状态并断开 Port。
- `error`：没有部分译文时显示错误；已有部分译文时保留内容并追加中断提示。
- Port 意外断开且未收到 `done`：按请求中断处理。

## API 请求和 SSE 解析

请求地址、认证方式、提示词和模型配置保持不变。请求体中的 `stream` 使用 `streamEnabled` 的值。

流式响应使用 `response.body.getReader()` 和 `TextDecoder` 读取：

- 使用缓冲区按完整行解析，支持一个 SSE 事件跨多个网络数据块。
- 只处理以 `data:` 开头的行。
- `data: [DONE]` 表示正常完成。
- 从 `choices[0].delta.content` 提取增量译文。
- 不包含内容的角色信息和空增量直接忽略。
- 无法解析的非空 `data` 视为无效流响应。
- 响应结束但未产生任何译文时，返回“翻译服务返回了无效结果”。

初版只支持 OpenAI-compatible Chat Completions SSE 格式，不兼容 Responses API 或服务商自定义事件格式。

## 请求取消

每个 Port 在 Service Worker 中对应一个独立 `AbortController`。

- 用户关闭浮层、重新选择文本或页面卸载时，内容脚本断开当前 Port。
- Service Worker 监听 Port 断开并立即执行 `AbortController.abort()`。
- 新请求开始前先断开旧 Port。
- 主动取消不向页面显示错误。
- 已取消请求的消息不能更新后续请求的浮层。

这会改变原调用链：原先内容脚本只用请求编号丢弃旧响应，后台请求仍会执行完毕；改造后旧响应不仅被隔离，后台 fetch 也会实际终止。

## 超时

- 非流式模式保持 30 秒总超时。
- 流式模式等待首个非空 `delta.content` 的上限为 30 秒。
- 每收到一个非空 `delta.content`，重新开始 30 秒无数据计时。
- 正常持续输出不受固定总时长限制。
- 连续 30 秒没有有效数据时中止请求，并返回“翻译请求超时”。

## 浮层行为

- 开始请求时显示“翻译中…”。
- 收到首个增量后用译文替换加载文案，后续增量持续追加。
- 正常结束时保留完整译文。
- 如果收到部分译文后发生错误，保留译文并在末尾显示“翻译中断：具体错误”。
- 如果尚未收到译文就发生错误，只显示现有中文错误提示。
- 定位、Shadow DOM 样式隔离和外部点击关闭行为保持不变。

## 修改范围

只修改以下文件：

- `background/service-worker.js`
- `content/content-script.js`
- `options/options.html`
- `options/options.js`
- `options/options.css`
- `README.md`

设计规格文件除外。不新增 Chrome 权限，不改变翻译提示词，不增加翻译历史、其他 API 协议、站点规则或测试文件。

## 验证标准

1. 未开启流式模式时，翻译行为与当前版本一致。
2. 开启流式模式后，浮层随 SSE 增量逐步显示中文。
3. 缺少 `streamEnabled` 的已有配置默认使用非流式响应。
4. 关闭浮层或重新选择文本时，旧请求立即取消且不能更新新浮层。
5. SSE 事件跨网络数据块时仍能正确解析。
6. 流式空响应、HTTP 错误、超时及中途断流按设计显示。
7. Manifest 可以被 Chrome 加载，JavaScript 语法和差异检查通过。
