# SBI Portfolio Tracker

[English](README.md) | [中文](README.zh.md) | [日本語](README.ja.md)

一个本地运行的 Node.js Web 应用，用来导入 SBI 证券 CSV 文件，并查看投资组合持仓、已实现/未实现盈亏、价格历史、FX 交易和黄金持仓。

本应用用于个人分析。它不是税务软件，也不提供税务申报结论。

## 功能

- 导入 SBI 日本股票和投资信托交易 CSV 文件。
- 导入 SBI 美股交割记录。
- 导入 SBI 配当金和分配金 CSV 文件。
- 导入 SBI FX 结算 CSV 文件。
- 导入 SBI 黄金订单 CSV 文件，并保存为详细的 `GOLD_JPY` 交易记录。
- 使用 SQLite 在本地保存数据。
- 同时计算股票和基金持仓。
- 使用 FIFO 计算已实现盈亏和剩余成本。
- 刷新日本股票、美股、已映射基金和黄金的最新价格。
- 保存股票、基金和黄金的日线价格历史，用于图表显示。
- 保存 USD/JPY 汇率，用于美股的日元估值。
- 显示投资组合摘要，包括市值、未实现盈亏、FIFO 已实现盈亏、配当/分配收入、总已实现盈亏、日盈亏和配置比例。
- 显示带分页的交易列表。
- 显示包含价格历史和买入/卖出标记的交易图表。
- 显示按月/按年的合并汇总历史，旧期间使用历史价格，并显示 Combined Total P/L 差异和期间 Detail 明细。
- 从本地 SQLite 快照生成每日投资组合报告；支持 OpenAI API 直接生成，也支持复制英文、中文或日文 prompt 到 ChatGPT。

## 版本 0.1.1

此版本改进了期间回顾和收入跟踪：

- 导入 SBI 配当/分配 CSV 文件，并把该收入计入已实现盈亏。
- 在投资组合摘要中单独显示配当/分配收入。
- 旧的月度/年度历史行使用各期间结束日的已保存历史价格计算。
- 在历史行添加 `Detail` 明细，用资产、FX 和期间内交易解释期间盈亏变化。
- 强化英文、中文、日文手动 ChatGPT prompt，避免 Deep Research 输出通用研究模板，而是直接生成投资组合报告。

## 版本 0.1.0

这是第一个本地优先的 SBI Portfolio Tracker 版本，包含：

- 导入 SBI 日本交易、美股交割记录、配当/分配记录、FX 结算和黄金订单 CSV。
- 使用 SQLite 进行本地个人数据存储。
- 投资组合摘要，包括 FIFO 已实现盈亏、配当/分配收入、未实现盈亏、日盈亏、配置比例，以及投资组合/FX 合并汇总。
- 刷新股票、已映射基金、黄金价格，并保存价格历史；支持 USD/JPY 估值。
- 交易图表和合并汇总历史页面，包括月度/年度盈亏变化的 Detail 归因明细。
- Daily Report 页面，支持 API 生成、保存报告，以及英文、中文、日文 ChatGPT 手动 prompt。
- 简单 JWT 登录和 Docker 支持。

## 要求

- Node.js
- npm

应用通过 `sqlite3` 包使用 SQLite。数据默认保存在：

```text
data/sbi-portfolio-tracker.sqlite
```

数据库文件不会提交到 Git。

## 设置

```powershell
npm install
npm start
```

默认监听端口是 `80`。

打开：

```text
http://localhost/
```

## 登录

应用使用简单密码登录，并通过 HTTP-only JWT cookie 保护投资组合页面。

运行前可以设置这些环境变量：

```powershell
$env:SBI_AUTH_PASSWORD="change-this-password"
$env:SBI_JWT_SECRET="change-this-long-random-secret"
npm start
```

如果未设置，本地开发默认密码是：

```text
admin
```

## OpenAI 设置（可选）

Daily Report 页面即使没有 API key 也可以使用：它会生成可复制到 ChatGPT 的 prompt。如果希望在应用内直接生成并保存报告，请设置：

```powershell
$env:OPENAI_API_KEY="your-openai-api-key"
```

可选设置：

```powershell
$env:OPENAI_REPORT_MODEL="gpt-4.1-mini"
$env:OPENAI_WEB_SEARCH_TOOL="web_search"
```

报告仅用于个人分析，不构成投资、法律或税务建议。

## Docker

Docker 镜像使用多阶段 `node:24-alpine` 构建，这样运行时镜像可以避开常被漏洞扫描标记的 Debian Perl 包。

Docker Hub：

```text
https://hub.docker.com/r/iriyano/sbi-portfolio-tracker
```

构建镜像：

```powershell
docker build -t sbi-portfolio-tracker .
```

使用持久化 SQLite 数据卷和登录设置运行：

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret sbi-portfolio-tracker
```

或者运行已发布镜像：

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret iriyano/sbi-portfolio-tracker
```

打开：

```text
http://localhost:8080/
```

## 主要页面

- `/import` - 上传 SBI 的交易、配当/分配、FX 和黄金 CSV 文件。
- `/transactions` - 查看导入并标准化后的交易记录。
- `/summary` - 查看投资组合摘要并更新价格。
- `/trade-chart` - 查看带买入/卖出标记的价格历史图表。
- `/history` - 查看按月/按年的合并汇总历史、盈亏变化和期间 Detail 归因。
- `/daily-report` - 构建每日报告快照，使用 API 生成报告，或复制英文、中文、日文 ChatGPT prompt。

## Daily Report

Daily Report 页面会从本地 SQLite 数据构建一个紧凑快照：

- 投资组合总计和当前持仓数量
- 按资产类别的配置比例
- 主要持仓和重要盈亏变动
- FX 摘要
- 数据质量警告

有两种使用方式：

- `Generate today's report`：把快照发送到 OpenAI Responses API，使用 Web 搜索生成 Markdown 报告，并保存到 SQLite。
- `Use ChatGPT Chat Instead`：复制可直接粘贴到 ChatGPT 的英文、中文或日文 prompt。此方式不需要 `OPENAI_API_KEY`。

投资组合数值由应用在本地计算。模型只用于撰写说明，并把快照与当前市场/新闻背景联系起来。

手动使用 ChatGPT 或 Deep Research 时，请粘贴完整生成的 prompt，包括 JSON 快照。只发送 `@深度研究` 之类的短触发词，可能会得到通用研究计划模板，而不是投资组合报告。

## 导入说明

导入器会标准化：

- 日本股票为类似 `7974.T` 的代码
- 美股为类似 `NVDA` 的代码
- 投资信托为自定义基金代码
- 黄金为 `GOLD_JPY`

配当/分配 CSV 会导入为不影响持仓数量的交易行：

- 股票收入使用 side `DIVIDEND`。
- 基金和 MMF 收入使用 side `DISTRIBUTION`。
- 收入行不会改变数量或 FIFO 批次。
- 投资组合已实现盈亏 = FIFO 已实现盈亏 + 配当/分配收入。

黄金 CSV 导入时会把汇总信息保存在 `gold_holdings`，同时也会把每一笔已成交黄金订单导入普通 `transactions` 表。详细交易记录用于摘要 FIFO、交易图表买入标记和黄金价格历史刷新。旧的手动黄金输入表单已经移除。

SBI CSV 通常只有日期，没有精确成交时间。应用会分配合成顺序：

- BUY 为 `09:00:00`
- SELL 为 `15:00:00`

这样可以稳定处理同一天买入/卖出的 FIFO 顺序。

## 价格刷新

在 `/summary` 页面点击 `Update Prices`。

当前行为：

- 跳过净持仓为零的资产。
- 从 Yahoo 兼容图表数据获取股票最新价格。
- 只有保存基金映射 URL/代码后，才获取基金价格。
- 获取黄金价格并转换为每克日元价格。
- 保存股票日线 OHLC 价格历史。
- 保存已映射基金的 NAV 历史。基金 NAV 以每 10,000 份为单位保存用于图表，并在摘要估值时转换回单位价格。
- 通过组合 `GC=F` 黄金期货和 `JPY=X` USD/JPY，保存每个日期的黄金 JPY/gram 历史。
- 当最新报价成功但日线历史接口还没有对应行时，会保存一条最新价格快照。
- 每次点击最多获取 30 天价格历史窗口。
- 价格历史从每个持仓股票、基金或黄金的最早 BUY 日期开始。
- 请求资产之间有延迟，并在遇到限流时停止。

对于美股，图表比较日期会在需要时移动到美国市场日期，而原始 SBI 交易日期仍然会显示在表格中。

日盈亏会把当前日元市值与上一条已保存价格历史日期进行比较。这样可以避免周末、节假日和基金 NAV 延迟造成的空白。

## 合并汇总历史

`/history` 会按本地当前日期计算当前月和当前年，因此当前行应该与实时 Combined Summary 一致。更早的月度和年度行是期间截止值，会使用每个期间结束日当天或之前最近一条已保存价格历史；如果没有历史价格，才回退使用当前资产价格。

在月度或年度行点击 `Detail`，可以查看该期间为什么变化。明细页会比较所选期间结束日和上一期间结束日，并显示：

- Combined Total P/L 变化的主要资产和 FX 原因
- 每个资产的市值、未实现盈亏、已实现盈亏、收入和总盈亏变化
- 该期间内的投资组合交易
- 该期间内的 FX 交易

## 数据来源说明

股票和黄金价格历史使用 Yahoo 兼容图表数据。黄金 JPY/gram 历史还依赖 USD/JPY 图表数据。基金价格历史使用 Yahoo Japan 前端基金历史接口和短期页面 token。该基金接口不是公开文档 API，因此只应视为本地个人使用的 best-effort 数据源。

如果 Yahoo 更改 token、接口或响应格式，历史回填可能失败。应用会显示清晰的获取错误，并且仍可使用最新价格快照作为 fallback。

## 交易图表

交易图表支持显示：

- 1 个月
- 6 个月
- 1 年
- 全部数据

X 轴可以按周、月或年显示标签。范围小于全部数据时，可以用 Previous/Next 翻页查看可见窗口。

## 测试

```powershell
npm test
```

当前测试覆盖：

- 投资组合 FIFO 摘要计算
- 股票、基金、美股、配当/分配、FX 和黄金解析辅助函数
- SQLite 存储适配器行为
- 每日报告快照和 ChatGPT prompt 生成
- 交易图表数据准备

## 许可证

ISC License。见 `LICENSE`。
