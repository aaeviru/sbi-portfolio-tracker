# SBI Portfolio Tracker

[English](README.md) | [中文](README.zh.md) | [日本語](README.ja.md)

一个本地运行的 Node.js Web 应用，用来导入 SBI 证券 CSV 文件，并查看投资组合持仓、已实现/未实现盈亏、价格历史、FX 交易和黄金持仓。

本应用用于个人分析。它不是税务软件，也不提供税务申报结论。

## 功能

- 导入 SBI 日本股票和投资信托交易 CSV 文件。
- 导入 SBI 美股交割记录。
- 导入 SBI FX 结算 CSV 文件。
- 导入 SBI 黄金订单 CSV 文件，并保存为详细的 `GOLD_JPY` 交易记录。
- 使用 SQLite 在本地保存数据。
- 同时计算股票和基金持仓。
- 使用 FIFO 计算已实现盈亏和剩余成本。
- 刷新日本股票、美股、已映射基金和黄金的最新价格。
- 保存股票、基金和黄金的日线价格历史，用于图表显示。
- 保存 USD/JPY 汇率，用于美股的日元估值。
- 显示投资组合摘要，包括市值、未实现盈亏、已实现盈亏、日盈亏和配置比例。
- 显示带分页的交易列表。
- 显示包含价格历史和买入/卖出标记的交易图表。

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

- `/import` - 上传 SBI 的交易、FX 和黄金 CSV 文件。
- `/transactions` - 查看导入并标准化后的交易记录。
- `/summary` - 查看投资组合摘要并更新价格。
- `/trade-chart` - 查看带买入/卖出标记的价格历史图表。

## 导入说明

导入器会标准化：

- 日本股票为类似 `7974.T` 的代码
- 美股为类似 `NVDA` 的代码
- 投资信托为自定义基金代码
- 黄金为 `GOLD_JPY`

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
- 股票、基金、美股、FX 和黄金解析辅助函数
- SQLite 存储适配器行为
- 交易图表数据准备

## 许可证

ISC License。见 `LICENSE`。
