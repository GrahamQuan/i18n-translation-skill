# sync-locales-from-en

[English](./README.md) | 简体中文

一个 AI skill，以 `messages/en/` 作为翻译基准来同步各语言文件。它会检测缺失键、通过 LLM 翻译并回写合并，同时保持键顺序和文件结构不变。

适用于 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)、Codex 和 [Cursor](https://cursor.com/) 的可安装 skill，也支持通过 `pnpm` 脚本独立运行。

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
2. **提取（Extract）** — 生成扁平化 `draft/{locale}-{NNN}.json` 分块文件，键格式为 `{file}::{dotpath}`（每块最多 50 个键）
3. **蓝图（Blueprint）** — 在 AI skill 运行期间，由 advisor 直接写入 `temp/YYYY-MM-DD/blueprint/`，生成本次运行的 advisor/executor 合约快照
4. **复制草稿（Copy draft）** — 将 `draft` 复制到 `translation`（仅在 run-context signature 完全一致的真实恢复场景下保留中断进度）
5. **翻译（Translate）** — 由 LLM 翻译 `translation/{locale}-{NNN}.json` 的值（每个分块一个 executor subagent，并通过有界 worker pool 启动）
6. **反扁平化（Unflatten）** — 将扁平文件还原为嵌套 JSON
7. **合并（Merge）** — 将翻译写回 `messages/{locale}/`，并保持键顺序
8. **测试（Test）** — 校验所有语言环境与 `en/` 的结构一致

## 安装

### 作为 Claude Code / Codex / Cursor skill 使用

1. 安装该 skill（可通过 skills.sh 或手动安装）
2. 运行安装脚本自动配置你的项目：
   ```bash
   bash .agents/skills/sync-locales-from-en/scripts/setup.sh
   ```
   该脚本会自动完成以下操作：
   - 将所有 `i18n:*` 脚本添加到你的 `package.json`（追加到 scripts 末尾）
   - 将临时文件排除项添加到 `.gitignore`
   - 安装 `tsx` 和 `@types/node` 作为 devDependencies（自动检测 pnpm/yarn/bun/npm）

   `.agents/skills` 是规范路径。如果你还想兼容 Claude Code，请把 `.claude/skills` 保持为指向 `.agents/skills` 的符号链接。

<details>
<summary>手动安装（如果你不想使用安装脚本）</summary>

1. 在项目 `.gitignore` 中添加：
   ```
   # i18n translation temp files
   .agents/skills/sync-locales-from-en/temp/
   ```
2. 在项目 `package.json` 的 `scripts` 中添加：
   ```json
   {
     "scripts": {
       "i18n:compare": "tsx .agents/skills/sync-locales-from-en/scripts/compare-locales.ts",
       "i18n:extract": "tsx .agents/skills/sync-locales-from-en/scripts/extract-locales.ts",
       "i18n:copy-draft": "tsx .agents/skills/sync-locales-from-en/scripts/copy-locales-draft.ts",
       "i18n:unflatten": "tsx .agents/skills/sync-locales-from-en/scripts/unflatten-translations.ts",
       "i18n:merge": "tsx .agents/skills/sync-locales-from-en/scripts/merge-translations.ts",
       "i18n:test": "tsx .agents/skills/sync-locales-from-en/scripts/test-locales.ts"
     }
   }
   ```
3. 安装依赖：`pnpm add -D tsx @types/node`
</details>

### 独立使用（不依赖 AI skill）

将本仓库克隆到你的项目中，运行安装脚本，或按上面的手动安装步骤操作。

## 使用方式

### 方式 1：AI skill（推荐）

如果你已安装 Claude Code、Codex 或 Cursor，直接运行：

```
/sync-locales-from-en
```

AI agent 会自动完成整个流程，并按分块文件并行启动 executor subagent（每块最多 50 个键）。

对于 AI 驱动的运行，advisor 在启动 executors 之前还会先把本次运行的行为快照写入 `temp/YYYY-MM-DD/blueprint/`。这样即使之后 skill 文本发生变化，重试或恢复中断任务时仍能保持一致行为。

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

翻译步骤有意保持手动，以便你自由使用任意 LLM 或翻译服务。`translation/{locale}-{NNN}.json` 是扁平 JSON 对象，便于直接传给各类 API。

`blueprint/` 这一步只用于 AI 编排场景。它由 advisor 在 skill 运行期间直接写入；没有单独的 `pnpm i18n:blueprint` 命令。手动执行 `pnpm` 脚本时可以跳过。

## Advisor / Executor 蓝图

AI skill 采用 advisor/executor 模式：

- Advisor = 负责 compare、extract、生成 blueprint、启动 executors、决定重试以及输出最终摘要的编排者
- Executors = 具体的分块翻译执行者，每个 executor 只处理一个 `translation/{locale}-{NNN}.json` 文件

每次运行时，skill 都会在 `temp/YYYY-MM-DD/blueprint/` 中生成一份行为快照：

- `advisor.md` — 面向人的运行意图说明
- `advisor.json` — 面向机器的流程、模型、目录和重试策略合约
- `executor-translation.md` — 面向人的翻译规则说明
- `executor-translation.json` — 严格的 executor 输入/输出合约

启动 executor 时，应优先传递一个精简的 JSON task envelope，并使用 `translation_file_ref`、blueprint refs 这类引用，而不是把整段长 prompt 在每个 executor 中重复粘贴。这样可以减少上下文膨胀，也更容易保持跨模型行为一致。

`advisor.json` 还应记录一个确定性的 run-context signature，它由规范化后的 missing-keys report、排序后的 draft 分块文件名、batch size 和 model defaults 共同决定。只有当这个 signature 完全一致时，才可以复用同一天的 `translation/` 和 `final/` 产物；否则 advisor 应先清理这些派生产物，再继续执行。

对于可恢复运行，advisor 还应在 `advisor.json` 中持久化一个 chunk registry，并且只启动状态仍为 `pending`、`retry_needed`、`failed` 或 `timed_out` 的分块。已经标记为 `ok` 的分块应被保留并跳过，避免重复翻译。

## 中间格式

翻译文件使用扁平 JSON 格式，并按分块拆分（每文件最多 50 个键），避免 LLM 输出破坏嵌套 JSON 或 Write 工具截断：

```json
// draft/es-001.json（前 50 个键）
{
  "main.json::home.feature.title": "Welcome to our platform",
  "main.json::home.feature.description": "The best way to manage your projects",
  "ui.json::buttons.submit": "Submit"
}
```

键名不会被修改，只翻译值。分块在反扁平化步骤中自动合并。

## 键排序规则

每层嵌套合并后的 JSON 都遵循以下顺序：

1. `title` 最前
2. `description` 第二
3. 数字键（`1`、`2`、`3`...）按数值升序
4. 其余键保持原始顺序

之所以需要自定义 JSON 序列化器，是因为 V8 在枚举属性时会把整数键放在字符串键之前，与插入顺序无关。

## 已知问题

### Executor subagent 输出被截断（已缓解）

当某个语言环境（locale）缺失键较多（50+）时，LLM executor subagent 可能输出截断。现已通过分块机制缓解——`pnpm i18n:extract` 会将大型语言环境拆分为每块最多 50 个键的分块文件（`es-001.json`、`es-002.json` 等），每个 executor subagent 处理一个分块。

若某个分块仍然失败，删除异常的 `translation/{locale}-{NNN}.json`，重新运行 `pnpm i18n:copy-draft` 后再试。

对于 AI 驱动的运行，不应无限等待 executor。advisor 应使用有界轮询、替换超时分块，并在顽固分块上升级到 advisor 级模型后再决定是否中止本次运行。

同时，executor 不应无限制并行启动。advisor 应通过有界 worker pool 发车，而不是一次性 fan-out 全部分块。一个安全的默认值是 `max_parallel_executors = 4`，如果运行环境暴露出更小的安全上限，则应进一步下调。

### Executor subagent 卡住 / 中断

Executor subagent 在翻译过程中可能卡住或被中断。`translation/` 层会保留已完成部分；在 run-context signature 完全一致的真实恢复场景下，`pnpm i18n:copy-draft` 会跳过 `translation/` 中已存在的分块文件，因此不会丢失已完成内容。

## 项目结构

```
.agents/skills/sync-locales-from-en/
  SKILL.md                          # skill 定义
  scripts/
    helpers.ts                      # 公共工具函数
    compare-locales.ts              # 查找缺失键
    extract-locales.ts              # 生成 draft 文件
    copy-locales-draft.ts           # draft → translation
    unflatten-translations.ts       # 扁平 JSON → 嵌套 JSON
    merge-translations.ts           # 合并到 messages/
    test-locales.ts                 # 校验结构
    setup.sh                        # 自动安装脚本（package.json、.gitignore、依赖）
  temp/YYYY-MM-DD/                  # 每日工作目录
    blueprint/                      # 本次运行的 advisor/executor 合约快照
    reference/                      # 缺失键对应的英文参考值
    draft/                          # 原始分块文件（不修改）
    translation/                    # 工作副本（executor subagent 写入）
    final/                          # 还原后的嵌套 JSON
```

## 许可证

MIT
