# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Copilot, Cursor, Gemini CLI, etc.) when working with code in this repository.

## 项目概述

词阶（Word Step）是一个单文件（index.html）的本地优先单词学习应用。整个应用包含 HTML、CSS 和 JavaScript 全部内联在单一文件中，无需构建步骤，可直接在浏览器中打开使用。

**核心特性**：
- 本地优先：所有数据（进度、学习记录、设置）存储在浏览器 IndexedDB 中
- 单文件架构：整个应用在一个 HTML 文件中，便于分发和部署
- 多词书支持：内置 10+ 套词书（初中、高中、CET4/6、TOEFL、GRE、考研等）
- 间隔重复学习系统：每日复习 + 新词学习 + 测验
- 查词功能：在所有本地词书中查询单词，支持跨词书查询
- 快速查询：学习页面中的单词可点击快速查询，支持多层级跳转
- TTS 朗读：短语和例句支持语音朗读（使用浏览器 TTS API，优先美音）

## 架构说明

### 单文件结构
`index.html` 包含完整的应用代码：
- 内联 CSS（约 900 行）：设计系统、响应式布局、深色模式支持
- 内联 JavaScript（约 1700 行）：状态管理、IndexedDB 操作、学习算法、UI 渲染
- 无外部依赖，纯原生 JavaScript

### 核心数据结构

**状态管理**（全局 `state` 对象）：
- `state.book`: 当前词书（包含 words 数组）
- `state.session`: 当前日期的学习会话
- `state.settings`: 用户设置（每日新词数量、活跃词书 ID）
- `state.tab`: 当前视图（today/stats/plan）
- `state.lookupWord`: 查词结果对象（包含单词详情、来源词书等）
- `state.lookupReturnContext`: 查词返回上下文（保存查词前的页面状态）
- `state.ttsUtterance`: 当前 TTS 朗读对象

**IndexedDB 存储**（6 个对象存储）：
- `books`: 用户导入的词书
- `meta`: 设置（key="settings"）
- `progress`: 单词学习进度（key="{bookId}:{wordId}"）
- `sessions`: 每日学习会话（key="{bookId}:{date}"）
- `activity`: 每日活动统计
- `quizResults`: 测验成绩

**词书 JSON 格式**：
参考 `wordbook-sample.json` 了解完整结构。每个单词包含：
- 基本信息：word, phonetic, meaning
- 学习内容：analysis, phrases, examples
- 辨析：synonyms, confusables
- 记忆：etymology（词源和记忆方法）
- 音频：audioBase64（可选 base64 编码的 MP3）

### 学习算法

**复习调度**（`recentReviewPlan` 函数）：
- 每日复习策略：复习最近学习日期的单词（非传统间隔重复）
- 从所有已学习的单词中，选择 `learnedDate` 等于最近日期且早于今天的单词
- 这是一个简化的"批次复习"模型，而非基于遗忘曲线的间隔算法

**学习流程**（`advanceStage` 函数）：
1. **Review 阶段**：复习今日待复习单词（认识/不认识）
2. **Learn 阶段**：学习新词（已掌握/不认识 → 不认识的会加入队列重新学习）
3. **Quiz 阶段**：
   - 释义选择测验（4 选 1）
   - 拼写测验（输入单词）
4. **Complete 阶段**：完成当日任务

**巩固标记**（`markForConsolidation` 函数）：
- 复习时答错 → 标记为 "fuzzy"
- 测验时答错 → 标记为 "fuzzy" 或 "spelling"
- 被标记的单词会出现在统计页面的"需要巩固"列表中

### UI 渲染

**视图切换**（`render` 函数）：
- 根据 `state.tab` 渲染不同页面
- 主要视图：Today（学习页）、Stats（统计页）、Plan（计划页）
- 学习页内部状态：Review/Learn/Quiz/Complete

**响应式设计**：
- 移动优先设计（最小宽度 320px）
- 最大内容宽度 560px 居中显示
- 支持安全区域（iPhone 刘海屏等）

## 开发和测试

### 本地运行
```bash
# 直接在浏览器中打开（推荐用于开发）
python3 -m http.server 8000
# 访问 http://localhost:8000
```

或在现代浏览器中直接打开 `index.html` 文件（需要支持 ES6+ 和 IndexedDB）。

### 运行测试
```bash
# 运行回归测试套件
node tests/review-regressions.cjs

# 测试覆盖：
# - 设置迁移和验证
# - 词书规范化（ID 冲突处理、空值处理）
# - 内置词书完整性检查
# - 学习流程和算法核心逻辑
```

### 代码修改注意事项

**JavaScript 提取和测试**：
- JavaScript 代码通过正则提取：`/<script>([\s\S]*?)<\/script>/`
- 测试套件使用 VM 沙箱执行提取的代码
- 被测试的函数名列表在 `tests/review-regressions.cjs` 的 `names` 数组中
- 修改核心函数时，确保函数名保持不变或更新测试中的 `names` 数组

**关键函数**（供测试使用）：
- 数据规范化：`normalizeSettings`, `normalizeWords`, `normalizeSession`
- 数据库操作：`dbRequest`, `loadBookById`
- 学习逻辑：`advanceStage`, `sessionCounts`, `upgradeSession`
- 测验系统：`statsQuizIsValid`, `renderStatsQuiz`, `answerStatsQuiz`
- 音频播放：`playRemotePronunciation`, `stopPronunciationPlayback`
- 查词功能：`searchAllBooks`, `performLookup`, `openLookupFromContext`, `makeWordLookupable`
- TTS 朗读：`playTTS`, `stopTTS`

**新增功能函数**（2024-11 更新）：
- `searchAllBooks(query)` - 在所有词书中搜索单词
- `performLookup(query)` - 执行查询并渲染结果
- `renderLookup()` - 渲染查词结果页面
- `makeWordLookupable(text, excludeWord)` - 将文本中的单词标记为可查询链接
- `playTTS(text, button)` - 使用浏览器 TTS 朗读文本
- `stopTTS()` - 停止当前 TTS 朗读
- `wordDetailHTML(word, enableLookup)` - 渲染单词详情，支持启用查词链接
- `reviewDetailHTML(word, enableLookup)` - 渲染复习详情，支持启用查词链接

**内置词书**：
- 词书元数据在 `BUNDLED_BOOKS` 数组中定义
- 添加新词书时需更新该数组和确保 JSON 文件存在
- 测试会验证元数据中的 `wordCount` 与实际 JSON 文件一致

**IndexedDB 操作**：
- 所有异步操作使用 Promise 包装
- 存储失败时显示友好错误（特别是 QuotaExceededError）
- 通过 `dbRequest` 函数统一处理事务

## 词书文件

项目包含多个 JSON 格式词书：
- 通用考试：`cet4_1000.json`, `cet6_3000.json`, `toefl_4000.json`, `gre_2000.json`
- 学历阶段：`middle_school_2000.json`, `hight_school_2000.json`
- 专项词汇：`kaoyan_2.json`, `plant1000.json`
- 技术词汇：`n2607.json`, `n2608.json`

这些文件体积较大（包含音频时可达数十 MB），修改时需考虑：
- JSON 格式完整性
- `wordCount` 与实际单词数一致
- 单词 ID 唯一性（系统会自动处理冲突但应避免）
