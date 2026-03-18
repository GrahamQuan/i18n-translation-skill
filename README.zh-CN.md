# sync-locales-from-en

[English](./README.md) | 简体中文

一个 AI skill，以 `messages/en/` 作为翻译基准来同步各语言文件。它会检测缺失键、通过 LLM 翻译并回写合并，同时保持键顺序和文件结构不变。

适用于 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) / [Cursor](https://cursor.com/) 的可安装 skill，也支持通过 `pnpm` 脚本独立运行。

## 工作原理

```
messages/en/main.json  （翻译来源）
messages/de/main.json  （自动同步）
messages/es/main.json  （自动同步）
messages/fr/main.json  （自动同步）
messages/zh/main.json  （自动同步）
```

流程如下：

1. **比对（Compare）** — 找出每个语言环境（locale）缺失的键
2. **提取（Extract）** — 生成扁平化 `draft/{locale}.json`，键格式为 `{file}::{dotpath}`
3. **复制草稿（Copy draft）** — 将 `draft` 复制到 `translation`（可保留中断进度）
4. **翻译（Translate）** — 由 LLM 翻译 `translation/{locale}.json` 的值
5. **反扁平化（Unflatten）** — 将扁平文件还原为嵌套 JSON
6. **合并（Merge）** — 将翻译写回 `messages/{locale}/`，并保持键顺序
7. **测试（Test）** — 校验所有语言环境与 `en/` 的结构一致

## 安装

### 作为 Claude Code / Cursor skill 使用

1. 安装该 skill（可通过 skills.sh 或手动安装）
2. 在项目 `.gitignore` 中添加：
   ```
   # i18n translation temp files
   .agents/skills/sync-locales-from-en/temp/
   .claude/skills/sync-locales-from-en/temp/
   ```
3. 在项目 `package.json` 的 `scripts` 中添加：
   ```json
   {
     "scripts": {
       "i18n:compare": "tsx .claude/skills/sync-locales-from-en/scripts/compare-locales.ts",
       "i18n:extract": "tsx .claude/skills/sync-locales-from-en/scripts/extract-locales.ts",
       "i18n:copy-draft": "tsx .claude/skills/sync-locales-from-en/scripts/copy-locales-draft.ts",
       "i18n:unflatten": "tsx .claude/skills/sync-locales-from-en/scripts/unflatten-translations.ts",
       "i18n:merge": "tsx .claude/skills/sync-locales-from-en/scripts/merge-translations.ts",
       "i18n:test": "tsx .claude/skills/sync-locales-from-en/scripts/test-locales.ts"
     }
   }
   ```
4. 安装依赖：`pnpm add -D tsx @types/node`

### 独立使用（不依赖 AI skill）

将本仓库克隆到你的项目中，然后按上面的第 2-4 步配置即可。

## 使用方式

### 方式 1：AI skill（推荐）

如果你已安装 Claude Code 或 Cursor，直接运行：

```
/sync-locales-from-en
```

AI agent 会自动完成整个流程，并按语言环境并行启动翻译 subagent。

### 方式 2：手动执行 pnpm 脚本

按步骤手动运行：

```bash
pnpm i18n:compare      # 查找缺失键
pnpm i18n:extract      # 生成 draft 文件
pnpm i18n:copy-draft   # draft → translation
# ... 你可以自行或通过任意 LLM 翻译 translation/*.json ...
pnpm i18n:unflatten    # 扁平 JSON → 嵌套 JSON
pnpm i18n:merge        # 合并到 messages/
pnpm i18n:test         # 校验
```

翻译步骤有意保持手动，以便你自由使用任意 LLM 或翻译服务。`translation/{locale}.json` 是扁平 JSON 对象，便于直接传给各类 API。

## 中间格式

翻译文件使用扁平 JSON 格式，避免 LLM 输出破坏嵌套 JSON：

```json
{
  "main.json::home.feature.title": "Welcome to our platform",
  "main.json::home.feature.description": "The best way to manage your projects",
  "ui.json::buttons.submit": "Submit"
}
```

键名不会被修改，只翻译值。

## 键排序规则

每层嵌套合并后的 JSON 都遵循以下顺序：

1. `title` 最前
2. `description` 第二
3. 数字键（`1`、`2`、`3`...）按数值升序
4. 其余键保持原始顺序

之所以需要自定义 JSON 序列化器，是因为 V8 在枚举属性时会把整数键放在字符串键之前，与插入顺序无关。

## 已知问题

### Subagent 输出被截断

当某个语言环境（locale）缺失键较多（200+）时，LLM subagent 可能输出截断——只写入约 64 个键而非完整集合。这是因为单次 Write tool 调用中的翻译 JSON 过大。

**解决方式：** `draft/` → `translation/` 分层可以降低风险。若 subagent 失败或截断，`draft/` 仍保持完好。删除异常的 `translation/{locale}.json`，重新运行 `pnpm i18n:copy-draft` 后再试。对于大批量键，建议拆分任务或要求 subagent 改用 Edit tool 而不是 Write tool。

### Subagent 卡住 / 中断

Subagent 在翻译过程中可能卡住或被中断。`translation/` 层会保留已完成部分；`pnpm i18n:copy-draft` 会跳过 `translation/` 中已存在文件的语言环境，因此不会丢失已完成内容。

## 项目结构

```
.claude/skills/sync-locales-from-en/
  SKILL.md                          # skill 定义
  scripts/
    helpers.ts                      # 公共工具函数
    compare-locales.ts              # 查找缺失键
    extract-locales.ts              # 生成 draft 文件
    copy-locales-draft.ts           # draft → translation
    unflatten-translations.ts       # 扁平 JSON → 嵌套 JSON
    merge-translations.ts           # 合并到 messages/
    test-locales.ts                 # 校验结构
  temp/YYYY-MM-DD/                  # 每日工作目录
    reference/                      # 缺失键对应的英文参考值
    draft/                          # 原始扁平文件（不修改）
    translation/                    # 工作副本（subagent 写入）
    final/                          # 还原后的嵌套 JSON
```

## 许可证

MIT
