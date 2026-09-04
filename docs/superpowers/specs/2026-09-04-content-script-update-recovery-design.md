# 插件更新后 Content Script 恢复设计

## 背景

Chrome 更新或重新加载扩展后，已打开网页中的旧 Content Script 可能继续保留页面事件处理器，但其扩展上下文已经失效。用户再次划词时，旧脚本无法连接新的 Service Worker；Port 断开回调读取 `chrome.runtime.lastError` 还可能再次抛出 `Extension context invalidated.`，使浮层停留在“翻译中”。

静态 `content_scripts` 只负责页面加载时注入。当前 Service Worker 没有为更新时已经打开的页面补注入脚本，因此仅处理断开异常只能避免无限加载，不能让旧页面恢复翻译。

## 目标

- 插件更新或开发者模式重新加载后，已打开的普通 HTTP/HTTPS 页面无需刷新即可继续翻译。
- 不自动刷新宿主页面，避免丢失表单、滚动位置和媒体状态。
- 页面中始终只有一个有效 Content Script 实例负责请求和浮层。
- 扩展上下文失效时不再永久停留在加载状态。
- 保持翻译协议、配置、监控、日志和选区行为不变。

## 方案

### 会话级补注入

Manifest 增加 `scripting` 权限。Service Worker 每次扩展加载会话首次启动时：

1. 通过 `chrome.storage.session` 检查本会话是否已恢复 Content Script。
2. 查询当前已打开的 HTTP/HTTPS 顶层页面。
3. 使用 `chrome.scripting.executeScript()` 注入 `content/content-script.js`。
4. 所有页面处理完成后写入会话标记，Service Worker 后续休眠和重启不重复扫描。

自动更新、启用扩展和开发者模式重新加载都会创建新的扩展加载会话。浏览器重启后恢复的页面也可通过相同路径补注入；正常新加载页面仍由 Manifest 静态注入。

单个页面因 Chrome Web Store 等浏览器限制无法注入时，只在 Service Worker 控制台记录警告，不影响其他页面恢复。

### Content Script 实例接管

每个 Content Script 实例创建唯一实例标识，并监听固定的实例激活事件。新实例初始化时广播自己的标识：

- 新实例忽略自己的激活事件。
- 已支持该协议的旧实例收到不同标识后，取消请求、删除浮层、停止 MutationObserver，并注销全部 DOM、窗口和 Storage 监听器。
- 当前尚未支持接管协议的旧版本无法主动注销；新实例通过观察 `document.documentElement` 的直接子节点，删除不属于当前实例的旧翻译浮层。旧上下文无法发起有效 API 请求，因此不会造成重复 Token 消耗。

当前实例创建的浮层在现有属性中写入实例标识。观察器只处理扩展直接挂在 `document.documentElement` 下的翻译浮层，不扫描或改动页面其他节点。

### 断开处理

Port 的主动断开统一经过安全函数。读取 `chrome.runtime.lastError`、调用 `port.disconnect()` 或注销 Storage 监听器失败时记录控制台信息并继续清理，不能阻断后续状态更新。

正常 Port 异常仍显示“翻译服务连接已中断”。若 Chrome 限制导致补注入失败，当前页面仍需手动刷新；修复不能让已经失效且不支持接管协议的旧脚本自行恢复。

## 调用链与副作用

```text
扩展更新或重新加载
        |
        v
Service Worker 首次启动
        |
        +-- 本会话已恢复 ----------> 跳过
        |
        +-- 查询现有 HTTP/HTTPS Tab
                 |
                 v
          注入最新版 Content Script
                 |
                 +-- 通知旧实例退出并取消旧请求
                 +-- 清除遗留浮层
                 +-- 注册新实例监听器
                 +-- 后续划词连接新 Service Worker
```

实例退出只影响旧 Content Script 自己创建的监听器、请求和浮层，不修改网页内容及翻译配置。Service Worker 的翻译 Port、API 请求、Token 与延迟统计调用链不变。

## 兼容性

- 继续只支持 Manifest 已声明的普通 HTTP/HTTPS 页面。
- 不增加 `tabs` 权限；现有 `<all_urls>` Host 权限用于匹配页面，`scripting` 仅用于补注入现有脚本。
- 不刷新页面，不改变用户页面状态。
- 会话标记使用 `chrome.storage.session`，不写入持久配置。
- 首次升级到本版本时兼容不支持实例接管的旧脚本；后续升级使用主动注销路径。

## 验证

- 使用纯 Node 浏览器 API 模拟器复现 `chrome.runtime.lastError` 抛错后浮层卡在加载状态，并在修复后验证回调能够继续显示中断错误。
- 使用 Service Worker API 模拟器验证同一扩展会话只补注入一次，新的会话会再次补注入。
- 检查重复实例接管后旧监听器、请求和浮层均被清理。
- 执行所有 JavaScript 文件语法检查、Manifest JSON 解析和 `git diff --check`。
- 按用户要求不使用 Chrome DevTools，不运行 lint 或 test。

由于不运行真实浏览器，本次无法验证 Chrome 自动更新和开发者模式重新加载的端到端生命周期；最终浏览器验证需在安装该版本后再次更新插件，并直接在更新前已打开的普通网页中划词。
