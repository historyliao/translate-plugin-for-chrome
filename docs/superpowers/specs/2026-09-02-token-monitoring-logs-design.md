# Token 监控与运行日志设计

## 背景

插件当前通过 Manifest V3 Service Worker 调用 OpenAI-compatible Chat Completions API，并通过 Port 向 Content Script 返回流式或非流式译文。Popup 只提供自动翻译开关和设置入口。

本次在 Popup 中增加 Token 监控和运行日志，用于查看 API 返回的真实 Token 消耗及定位插件运行错误。所有数据只保存在 `chrome.storage.local`，不上传到其他服务。

## 目标

- Popup 使用“控制 / 监控 / 日志”三个标签页。
- 统计 API 返回的真实 `usage`，不在本地估算 Token。
- 展示历史总 Token、今日实时消耗、按模型累计和最近 90 天每日消耗。
- 同时保存并展示输入、输出和总 Token。
- 记录程序错误及翻译成功、请求取消、usage 缺失等关键信息。
- 并发翻译、重置统计和清空日志时不发生存储覆盖。
- 日志不保存翻译内容、凭据或完整请求及响应信息。

## 非目标

- 不修改翻译提示词、文本选择规则和悬浮译文样式。
- 不统计 API 未返回的 usage，不引入 tokenizer 或估算逻辑。
- 不记录单次请求的 Token 明细，不提供费用估算。
- 不增加远程监控、日志上传、导出或跨浏览器同步。
- 不为不支持 `stream_options` 的服务自动重试或降级。
- 不新增设置项、第三方图表库或单元测试。

## 整体架构

```text
页面选择英文
    |
    v
Content Script
    |
    | translation Port
    v
Service Worker
    |
    +-- 调用 OpenAI-compatible API
    |
    +-- 非流式：读取 content 和 usage
    |
    +-- 流式：解析 SSE content 和末尾 usage
    |
    +-- 串行存储队列
            |
            +-- tokenUsage
            |    +-- 历史总量
            |    +-- 按 model 累计
            |    +-- 最近 90 天每日累计
            |
            +-- runtimeLogs（最多 500 条）
                     |
                     v
              Popup 三标签页
              控制 | 监控 | 日志
```

各组件职责如下：

- `content/content-script.js`：继续负责选区、悬浮展示和取消请求；仅在自身发生可上报错误时发送固定日志事件。
- `background/service-worker.js`：负责翻译、提取真实 usage、聚合 Token、生成日志、执行保留策略和串行化所有存储修改。
- `popup/popup.html`、`popup/popup.js`、`popup/popup.css`：负责三标签页、统计和日志展示，以及发起清空或重置命令。
- `options`：保留现有 Base URL、Token、Model 和流式开关；存储失败时可发送固定日志事件，不增加配置项。
- `chrome.storage.local`：保存现有配置、`tokenUsage` 和 `runtimeLogs`。

Content Script 使用的 `chunk`、`done`、`error` Port 消息协议保持不变。

## 本地数据模型

### Token 统计

```js
tokenUsage: {
  total: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  },
  byModel: {
    "<请求时的 model 字符串>": {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  },
  byDate: {
    "YYYY-MM-DD": {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  }
}
```

- `total` 长期累计全部有效 usage。
- `byModel` 直接使用请求时配置的 `model` 字符串分组，长期保留并按总 Token 降序展示。
- `byDate` 使用浏览器本地时区，以收到 usage 时的本地日期归档。
- 每次写入删除当天及此前 89 个本地自然日之外的日期项，即最多保留最近 90 天。
- 重置统计删除 `tokenUsage`；Popup 将总量显示为 0，并对模型和日期区域显示空状态。

### 运行日志

```js
runtimeLogs: [
  {
    timestamp: 1788315000000,
    level: "error",
    event: "request_timeout",
    model: "gpt-4o-mini",
    message: "翻译请求超时"
  }
]
```

- 日志按时间升序保存，Popup 按时间倒序展示。
- 每次追加后只保留最新 500 条。
- `timestamp` 保存 Unix 毫秒时间戳，Popup 使用浏览器本地时间显示。
- `level` 只允许 `error` 和 `info`。
- `event` 使用固定事件标识，`message` 由 Service Worker 的固定映射生成。
- `model` 使用本次请求的模型；事件无法关联模型时保存空字符串，界面显示 `-`。
- 清空日志删除 `runtimeLogs`，不影响 `tokenUsage`。

## Usage 采集规则

### 通用规则

只有同时满足以下条件的 usage 才可累计：

- `prompt_tokens`、`completion_tokens`、`total_tokens` 三项全部存在；
- 三项都是非负整数；
- usage 来源于本次 API 响应。

插件分别保存 API 返回的三项数值，不根据其中任意字段推导或修正其他字段。请求获得 HTTP 成功响应后，usage 缺失、字段不完整或字段无效时，本次请求不累计任何 Token，并记录 `usage_missing` info 日志。网络失败或 HTTP 错误没有可解析的成功响应，只记录对应 error 日志，不重复记录 `usage_missing`。

同一响应最多累计一次 usage。只要收到完整有效的真实 usage 就记录实际消耗，不以译文是否有效或流是否最终正常结束作为撤销条件。

### 非流式响应

非流式响应解析 JSON 后先检查并记录 usage，再检查 `choices[0].message.content`。因此，API 已返回有效 usage 但译文无效时，Token 仍计入统计，翻译仍按现有逻辑向用户返回无效响应错误。

### 流式响应

流式请求体在 `stream: true` 时增加：

```json
{
  "stream_options": {
    "include_usage": true
  }
}
```

非流式请求不发送 `stream_options`。

SSE 解析同时识别以下事件：

- 带 `choices[0].delta.content` 的内容事件；
- `choices` 为空或不存在、但包含 `usage` 的用量事件；
- `data: [DONE]` 完成标志。

内容和 usage 可出现在同一个 JSON 事件中，解析时分别处理。首次有效 usage 到达后立即排队记录，后续重复 usage 忽略。收到有效 usage 后即使流在 `[DONE]` 前中断，仍保留真实消耗并向用户报告流中断。

如果兼容服务不支持 `stream_options` 并返回 HTTP 错误，插件直接展示和记录该错误，不删除字段重试。用户可以关闭流式响应继续使用。

## 串行存储与并发语义

Service Worker 维护一个内存 Promise 写入队列。所有 Token 累计、日志追加、Token 重置和日志清空都进入同一队列，并按进入顺序执行 `storage.get`、修改和 `storage.set` 或 `storage.remove`。

队列返回当前操作的原始 Promise，同时将捕获错误后的 Promise 作为下一次操作的起点：

- 翻译产生的监控写入失败时使用 `console.error` 暴露，不把已成功的翻译改成失败。
- 重置和清空失败时将失败结果返回 Popup，由 Popup 显示错误并保持打开。
- 单次存储失败不会让队列永久进入 rejected 状态，后续操作仍可执行。

顺序语义如下：

- 重置之前已经排队完成的统计会被清除。
- 重置之后才进入队列的 usage 会作为新统计累计。
- 清空日志之前的日志被清除，之后产生的日志正常保留。

Service Worker 重启后队列从空状态开始，已完成的本地存储数据不受影响。Popup 直接读取统计和日志，但 Token 重置和日志清空通过 Service Worker 消息执行，以避免绕过队列。现有自动翻译开关继续直接写入原有配置字段。

## 日志事件与脱敏

### error 事件

- 配置缺失和 Base URL 无效；
- 网络失败、HTTP 错误和请求超时；
- 非流式响应无效、流数据无效和流中断；
- Content Script 与翻译 Service Worker 的连接异常；
- Popup、Options 或 Content Script 中可上报的存储读写失败；
- 打开设置页、重置统计或清空日志失败。

### info 事件

- 翻译成功；
- 用户关闭悬浮结果或页面离开导致请求取消；
- HTTP 成功响应中的 usage 缺失、不完整或无效。

Service Worker 内部翻译事件直接生成日志。Popup、Options 和 Content Script 只向 Service Worker 发送允许的固定事件标识，由 Service Worker 映射为固定级别和文案；调用方不能提供任意日志正文。

日志禁止保存：

- 用户选择的原文；
- 翻译结果；
- API Token；
- 完整 Base URL；
- 请求体和完整响应体；
- 原始异常对象或可能包含敏感上下文的堆栈。

HTTP 错误只记录状态码。日志中的模型名来自用户明确配置的 `model` 字符串。

如果 `chrome.storage.local` 本身写入失败，该错误无法可靠写回同一故障存储，只输出到对应扩展上下文的控制台。插件更新后，旧页面中的 Content Script 若已发生 `Extension context invalidated`，由于扩展通信能力已经失效，也无法持久化该错误；用户重新加载页面后恢复。

## Popup 交互设计

Popup 宽度调整为约 360px，顶部保留标题并增加“控制 / 监控 / 日志”三个标签。标签切换只改变当前显示区域，不写入配置。

### 控制

- 保留自动翻译开关、当前状态和“打开设置”按钮。
- 保留现有保存失败和打开设置失败提示。

### 监控

- 历史总 Token 和今日实时消耗作为两张主卡片。
- 每张卡片主显示 `totalTokens`，并显示输入和输出 Token。
- 使用纯 CSS 柱状图显示最近 7 个本地自然日的 `totalTokens`，没有消费的日期显示为零高度；完全没有历史数据时显示空状态，不生成虚假趋势。
- 模型累计列表按 `totalTokens` 降序显示，每项展示模型、输入、输出和总 Token。
- 最近 90 天每日明细按日期倒序显示输入、输出和总 Token。
- “重置 Token 统计”使用危险操作样式，并调用浏览器确认弹窗：

  > 将永久清除历史总量、模型统计和每日统计，此操作不会清除日志，是否继续？

- 用户取消确认时不发送重置命令。

### 日志

- 提供“全部 / 错误 / 信息”筛选，默认显示全部。
- 每条显示本地时间、级别、事件说明和模型。
- 日志区域固定最大高度并允许滚动。
- “清空日志”只清除日志，不要求二次确认，也不影响 Token 统计。
- 无日志或筛选结果为空时显示对应空状态。

Popup 打开期间监听 `chrome.storage.onChanged`。`tokenUsage` 或 `runtimeLogs` 变化时重新渲染对应标签，使今日统计和日志实时更新。

## 请求结果与副作用

```text
API 响应 ──> 提取真实 usage ──> 串行累计 Token
请求结果 ──> 生成固定日志事件 ──> 串行追加日志
```

- Token 和日志是翻译主流程的旁路副作用，不能改变已有 `chunk`、`done`、`error` 行为。
- 非流式和流式的译文校验、超时、网络错误及用户提示保持现有语义。
- Port 断开时继续中止请求并记录取消；正常发送 `done` 后的 Port 断开不记录取消。
- HTTP、网络、超时和响应错误继续使用现有用户文案，同时记录对应脱敏事件。
- 翻译成功和 usage 缺失是两个独立事件；成功响应未携带 usage 时两条 info 日志均保留。

## 兼容性

- 不修改现有存储配置字段，升级后无需迁移 Base URL、Token、Model、流式开关或自动翻译开关。
- 新增统计和日志键不存在时按空数据处理。
- 不修改 Content Script 的 Port 协议及悬浮层交互。
- OpenAI-compatible 服务必须返回完整标准 usage 才会被统计；部分字段存在时不做兼容性估算。
- 流式服务不支持 `stream_options.include_usage` 时按真实 HTTP 错误处理。

## 验证计划

### 静态检查

- 对所有修改的 JavaScript 文件执行 `node --check`。
- 验证 `manifest.json` 可正常解析。
- 项目没有 Makefile，因此不执行 make 目标。
- 不新增单元测试，不执行 lint。

### Chrome 验证

使用 Chrome DevTools MCP 检查：

- 三个标签的切换、空状态、列表滚动和日志筛选；
- 原有自动翻译开关、状态显示和设置入口；
- Token 与日志存储变化后的 Popup 实时刷新；
- 重置确认、取消和成功后的界面状态；
- 清空日志不影响 Token 统计。

### 数据与请求场景

- 非流式响应的输入、输出和总 Token 正确累计；
- 流式请求发送 `stream_options.include_usage` 并解析末尾 usage；
- HTTP 成功响应中的 usage 缺失或不完整时统计不变并产生 info 日志；
- 相同模型合并、不同模型分组，日期按本地时区累计；
- 并发请求完成时累计值不丢失；
- 最近 90 天和最新 500 条保留策略正确；
- 配置错误、网络错误、HTTP 错误、超时、无效响应、流中断和取消产生对应日志；
- 本地存储中不存在原文、译文、Token、完整 Base URL 和响应体。

真实流式及非流式 usage 的端到端验证依赖用户配置的 OpenAI-compatible 服务。没有可用配置时，只能验证请求结构、解析路径、UI 和本地数据行为，不能声称完成真实 Token 端到端验证。

## 完成标准

- Popup 三标签布局可用，现有控制和设置行为无回归。
- 历史总量、今日、模型和每日统计仅来源于完整真实 usage。
- 并发统计、重置和清空遵循已定义的队列顺序且不覆盖数据。
- 日志能够展示已定义的 error 和 info 事件，并满足 500 条限制及脱敏要求。
- 每日明细最多保留最近 90 天，历史总量和模型累计长期保留。
- 静态检查和可执行的 Chrome 验证完成，未完成的真实 API 验证被明确说明。
