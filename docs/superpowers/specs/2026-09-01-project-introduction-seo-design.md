# 项目简介与检索优化设计

## 目标

优化项目在 GitHub 搜索和相关推荐中的关键词覆盖，同时让进入仓库的中文目标用户快速理解项目价值。文案突出简单、开放、自定义模型、划词翻译、流式响应和 Token 控制，不添加代码当前尚未提供的能力。

## GitHub Description

GitHub Description 使用英文，扩大 `Chrome extension`、`AI translation`、`OpenAI-compatible API` 和 `custom model` 等英文检索覆盖：

```text
Simple, open-source AI translation Chrome extension. Select English text for instant Chinese translation using any OpenAI-compatible API and your own model.
```

Description 保持单行、直接描述用户行为和技术开放性，不堆砌 Topics，不使用“最好”“最快”等无法验证的宣传语。

## GitHub Topics

设置以下 Topics：

```text
chrome-extension
translation
ai-translation
openai-compatible
llm
english-to-chinese
browser-extension
translator
```

Topics 分别覆盖产品形态、核心功能、技术协议、模型类别、翻译方向和常用工具检索词。只保留与当前代码直接相关的标签。

## README 首屏

保留现有仓库标题，将标题下方的单句简介替换为：

```markdown
一个简单、开放、可自定义模型的 AI 划词翻译 Chrome 插件。选中网页中的英文，即可通过你自己的 OpenAI-compatible API 实时翻译成中文。

- 简单：加载插件、填写 API 配置即可使用
- 开放：MIT 开源，不绑定任何模型服务商
- 自定义模型：自由配置 Base URL、Token 和 Model
- 即选即译：选中英文后自动显示中文浮层
- 灵活控制：支持流式响应和一键暂停翻译，避免浪费 Token
```

该内容放在安装说明之前，使用户打开仓库后无需滚动即可看到定位和核心卖点。后续安装、配置、使用、升级和 License 内容保持不变。

## 修改与发布范围

- 修改本地 `README.md`。
- 更新 `historyliao/translate-plugin-for-chrome` 的 GitHub Description。
- 将仓库 Topics 设置为设计中列出的 8 项。
- 不修改项目名、代码、Manifest、功能行为、Homepage 或 License。

## 验证标准

1. README 标题下方出现批准的定位文案和 5 项卖点。
2. README 原有安装、配置、使用、升级和 License 内容保持不变。
3. GitHub Description 与批准的英文文案完全一致。
4. GitHub Topics 与批准的 8 项完全一致，没有遗漏或额外标签。
5. `git diff --check` 通过。
6. 通过 GitHub API 回读 Description 和 Topics，确认远端实际状态。
