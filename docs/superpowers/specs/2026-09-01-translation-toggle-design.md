# 翻译功能开关设计

## 目标

为 Chrome 翻译插件增加一个全局启用开关。用户点击工具栏插件图标打开轻量 Popup，在其中关闭或重新开启自动翻译，避免仅选择文本时仍调用大模型 API、产生不必要的 Token 消耗，同时保留便捷的参数设置入口。

## 开关与默认行为

新增 `translationEnabled` 配置，保存在 `chrome.storage.local`。

- `translationEnabled` 为 `true` 时，选择包含英文字母的文本会进入现有翻译流程。
- `translationEnabled` 为 `false` 时，选择文本不会创建 Port，也不会调用 API。
- 配置不存在时按 `true` 处理，保证已有用户升级后继续使用当前自动翻译行为。
- 开关是浏览器扩展级全局状态，对所有普通网页生效，不按标签页或站点分别保存。

## Popup 交互

点击工具栏插件图标打开轻量 Popup：

```text
┌────────────────────────┐
│ 英文翻译               │
│                        │
│ 自动翻译        [开关] │
│ 已开启 / 已关闭        │
│                        │
│       打开设置         │
└────────────────────────┘
```

Popup 只负责：

- 读取和切换 `translationEnabled`；
- 调用 `chrome.runtime.openOptionsPage()` 打开现有完整设置页。

Popup 不重复提供 Base URL、Token、Model 或流式响应表单。打开 Popup 本身不会改变翻译状态。

开关状态的展示规则为：

- 开启时 Popup 显示绿色“已开启”，Badge 显示绿色 `ON`。
- 关闭时 Popup 显示灰色“已关闭”，Badge 显示灰色 `OFF`。

`manifest.json` 在 `action` 中声明 `default_popup`。声明后 Chrome 不再向 Service Worker 发送 `chrome.action.onClicked` 事件，因此后台移除直接点击切换入口，状态写入由 Popup 独立负责。

## 设置页关闭行为

用户通过 Popup 的“打开设置”进入现有 options 页面。点击“保存设置”后：

- 表单校验通过且 `chrome.storage.local.set()` 成功时，调用 `window.close()` 关闭整个 options 标签页。
- 表单校验失败时保持页面打开，并显示现有字段错误。
- 存储写入失败时保持页面打开，并显示“保存配置失败，请重试”。
- 无论 options 页面从 Popup 还是 `chrome://extensions` 打开，保存成功后都执行相同关闭行为。

## 状态初始化与同步

Popup 负责切换状态，Service Worker 负责同步 Badge：

```text
Popup 切换开关
    |
    v
写入 chrome.storage.local
    |
    +--> Service Worker 更新 Badge 和工具栏提示文字
    |
    +--> 所有已打开页面更新本地开关状态
```

Service Worker 在以下时机调用同一 Badge 刷新逻辑：

- 插件首次安装；
- Chrome 启动；
- Service Worker 脚本重新执行；
- `translationEnabled` 被 Popup 或其他扩展上下文修改。

配置不存在时，Badge 初始化为开启状态，但不为此额外写入存储。

## 内容脚本调用链

内容脚本启动时从 `chrome.storage.local` 读取一次 `translationEnabled`，不存在时初始化为 `true`。随后监听 `chrome.storage.onChanged`，使已打开页面无需刷新即可响应切换。

页面选区调用链调整为：

```text
鼠标左键松开
    |
    +-- translationEnabled=false -> 直接返回
    |
    v
读取和校验选区
    |
    v
现有 Port 翻译流程
```

关闭状态的判断位于 `handleMouseUp` 入口，不读取选区、不创建浮层、不连接 Service Worker。

## 即时关闭与请求取消

当 `translationEnabled` 从 `true` 变为 `false` 时，每个已打开页面立即调用现有浮层关闭路径：

- 关闭当前翻译浮层；
- 断开当前翻译 Port；
- Service Worker 收到 Port 断开事件后执行 `AbortController.abort()`；
- 清除当前部分译文；
- 使旧请求不能继续更新页面。

该行为复用现有 `closeOverlay` 和 `cancelTranslation`，不新增另一套取消流程。主动关闭功能不显示中断错误。

当状态重新变为 `true` 时，内容脚本只更新本地状态；下一次选择英文文本时恢复翻译，不自动重试上一次已取消的请求。

## 错误处理

- 读取开关状态失败时维持默认开启行为，避免把扩展静默锁死在不可用状态。
- Popup 写入开关失败时恢复原开关状态，并在 Popup 中显示中文错误提示。
- Badge 更新失败不影响存储状态和页面翻译行为；错误记录在 Service Worker 控制台，不在网页中显示浮层。
- 打开设置页失败时在 Popup 中显示中文错误提示，Popup 保持打开。
- options 页面保存失败时保留用户已填写的表单内容，并显示中文错误提示。

## 修改范围

最终功能涉及以下文件：

- `background/service-worker.js`
- `content/content-script.js`
- `manifest.json`
- `popup/popup.html`
- `popup/popup.js`
- `popup/popup.css`
- `options/options.js`
- `README.md`

设计规格文件除外。不新增 Chrome 权限，不修改设置页字段、翻译 API、流式响应协议、提示词或浮层样式。

## 验证标准

1. 旧配置中没有 `translationEnabled` 时默认开启翻译。
2. 点击工具栏图标只打开 Popup，不会立即改变状态。
3. Popup 开关可以在开启和关闭间切换，状态文字和 Badge 同步变化。
4. 关闭状态下选择英文不创建翻译 Port，也不调用 API。
5. 翻译过程中关闭功能时，浮层立即消失，后台请求被取消。
6. 重新开启后，已打开页面无需刷新即可恢复翻译。
7. 多个已打开页面同步响应开关变化。
8. 点击“打开设置”可以进入现有参数设置页。
9. 关闭再打开 Popup 后显示存储中的真实状态。
10. 写入失败时 Popup 恢复原状态并显示错误。
11. options 页面保存成功后关闭标签页，校验或存储失败时保持打开。
12. Chrome 或 Service Worker 重启后，Badge 与保存状态一致。
13. Manifest JSON、JavaScript 语法、差异检查和 Chrome 实际加载通过。
