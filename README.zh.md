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
- 按预期市场交易日记录价格历史覆盖，包括完成、无数据、失败和等待重试区间。
- 使用独立的价格更新页面显示进度、状态筛选、单资产重试、数据源日期和覆盖明细。
- 保存 USD/JPY 汇率，用于美股的日元估值。
- 显示投资组合摘要，包括市值、未实现盈亏、FIFO 已实现盈亏、配当/分配收入、总已实现盈亏、日盈亏和配置比例。
- 显示带分页的交易列表。
- 显示包含价格历史、买入/卖出标记、日期倒序交易记录和技术指标的交易图表。
- 显示按月/按年的合并汇总历史，旧期间使用历史价格，并显示 Combined Total P/L 差异和期间 Detail 明细。
- 从本地 SQLite 快照生成每日投资组合报告；支持 OpenAI API 直接生成，也支持复制英文、中文或日文 prompt 到 ChatGPT。
- 在导航栏显示应用版本。

## 版本 0.2.0

此版本增强了已映射基金的价格更新，使其能适应 Yahoo 日本财经页面状态格式变化和基金净值公布延迟：

- 同时支持普通和转义的 Yahoo 基金 token 表示；拒绝格式错误或缺失的 token，并且不保存 token 内容。
- 保留 Yahoo 显示的净值公布日期和现有的每万份单位换算，避免给上一期净值标上新的日本日历日期。
- 对符合营业日条件但尚未公布的基金日期使用“等待公布”状态，而不是记录为失败；历史请求截止到数据源最新净值日期。
- 对真实的网络、token 和响应格式错误保留可见错误与重试退避；手动 Retry 会保留旧净值记录并补全恢复后的覆盖。
- 如果无法解析公开页面的净值标记，则回退到近期历史数据，同时避免请求尚未公布的日期。
- 非本地启动必须显式配置安全认证，同时保留显式的仅本地开发模式。
- 恢复经过测试的 Linux 运行时和依赖工作流。
- 增加离线数据源、价格更新页面和临时 SQLite 的确定性测试，无需数据库迁移。

## 版本 0.1.3

此版本提供更可靠、可检查的价格更新流程：

- 把价格更新从 Summary 页面移动到独立的 `/prices` 页面，增加实时进度、状态筛选、数据源日期和单资产重试。
- 一次更新可以按日期从新到旧填补多个缺失区间，并让所有资产共享请求数量和运行时间上限。
- 把市场交易日覆盖保存为 `COMPLETE`、`NO_DATA` 或 `FAILED`，避免重复请求已完成区间和已确认无数据区间。
- 对数据源错误增加重试退避；单资产 Retry 可以为该资产跳过一次当前等待时间。
- 使用日本和美国市场日历判断预期日期，而不是把每个工作日都视为交易日。
- 判断覆盖时，把实时报价快照与已完成日线历史分开处理。
- 修复外币 MMF 估值，并统一 SBI 冈三 MMF 名称变体，避免同一持仓被拆成重复资产。
- 根据资产分别使用东京日期、纽约日期、基金公布日期和 MMF 导入日期。

## 版本 0.1.2

此版本扩展了图表分析和历史数据范围：

- 在 Trade Chart 中增加 SMA 20/50/200、Bollinger Bands 20/2、RSI 14 和 MACD 12/26/9。
- 当历史数据足够时，显示 20 日年化波动率、52 周最高/最低价和回撤。
- 使用 J-Quants 回填较旧的日本股票历史，近期和归档区间继续使用 Yahoo 兼容数据。
- 历史开始日改为“两年前”和“最早 BUY 日期”中较早的日期。
- 交易历史按日期倒序显示，并在导航栏显示应用版本。
- 统一 SBI 冈三美元货币市场基金的名称变体。

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

应用使用简单密码登录，并通过 HTTP-only JWT cookie 保护投资组合页面。普通启动采用失败关闭策略：运行前必须设置至少 12 个字符的认证密码，以及一个独立且至少 32 个字符的 JWT 签名密钥。

```powershell
$env:SBI_AUTH_PASSWORD = Read-Host "Enter the application password"
$env:SBI_JWT_SECRET = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
npm start
```

已知占位值会被拒绝，并且两个值不能相同。启动错误只显示无效的设置名称，不会显示设置值。

仅在本地开发时，可以显式启用本地专用模式：

```powershell
$env:SBI_LOCAL_ONLY="true"
npm start
```

本地专用模式只绑定 `127.0.0.1`；未提供密码时使用 `admin`，JWT 使用独立的开发专用密钥。面向互联网的部署绝不能启用 `SBI_LOCAL_ONLY`。

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

## J-Quants 设置（可选）

日本股票历史的分段方式以本集成开发时使用的免费范围为前提：J-Quants 提供最近两年中较旧的部分，Yahoo 兼容历史提供最近 12 周以及早于两年的日期。下面的方式不会回显 key；它会把 key 保存为用户环境变量，同时加载到当前 PowerShell 会话，然后启动应用：

```powershell
$secret = Read-Host "Enter your J-Quants API key" -AsSecureString
$key = [System.Net.NetworkCredential]::new("", $secret).Password
[Environment]::SetEnvironmentVariable("JQUANTS_API_KEY", $key, "User")
$env:JQUANTS_API_KEY = $key
Remove-Variable secret, key
Write-Host (-not [string]::IsNullOrWhiteSpace($env:JQUANTS_API_KEY))
npm start
```

检查结果必须是 `True`。key 只由服务器读取，不会保存到 SQLite、浏览器存储或 Git。

没有该 key 时应用仍可启动，但分配给 J-Quants 范围的日本股票日期会保持失败状态，直到配置 key 或 SQLite 中已经存在对应数据。

可以选择调整价格历史更新上限：

```powershell
$env:PRICE_HISTORY_MAX_REQUESTS="40"
$env:PRICE_HISTORY_MAX_DURATION_MS="600000"
```

这些值限制一次 Update All 的总工作量。失败区间和下次重试时间会保存，因此以后可以继续，而不必从头开始。

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
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD -e SBI_JWT_SECRET sbi-portfolio-tracker
```

或者运行已发布镜像：

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD -e SBI_JWT_SECRET iriyano/sbi-portfolio-tracker
```

打开：

```text
http://localhost:8080/
```

## 主要页面

- `/import` - 上传 SBI 的交易、配当/分配、FX 和黄金 CSV 文件。
- `/transactions` - 查看导入并标准化后的交易记录。
- `/summary` - 查看投资组合和 FX 合并摘要，并编辑基金价格来源映射。
- `/prices` - 更新当前价格和历史，监控进度，筛选状态，检查覆盖并重试单个资产。
- `/trade-chart` - 查看带买入/卖出标记和技术指标的价格历史图表。
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

在 `/prices` 页面点击 `Update All`。任务在后台运行，页面会轮询 `/prices/status` 来显示进度。每个资产的 `Retry` 会只为该资产执行同一流程，并跳过一次当前重试等待时间。

当前行为：

- 跳过净持仓为零的资产。
- 从 Yahoo 兼容图表数据获取股票最新价格。
- 日本股票历史中，最近 12 周使用 Yahoo，最近两年内较旧的部分使用 J-Quants，早于两年的部分使用 Yahoo 归档历史。
- 每个当前持有的股票、基金或黄金，其历史开始日是“两年前”和“最早 BUY 日期”中较早的日期。
- 只有保存基金映射 URL/代码后，才获取基金价格。
- 获取黄金价格并转换为每克日元价格。
- 外币 MMF 使用 SBI 交易 CSV 中导入的价格，不请求市场历史数据源。
- 保存股票日线 OHLC 价格历史。
- 保存已映射基金的 NAV 历史。基金 NAV 以每 10,000 份为单位保存用于图表，并在摘要估值时转换回单位价格。
- 通过组合 `GC=F` 黄金期货和 `JPY=X` USD/JPY，保存每个日期的黄金 JPY/gram 历史。
- 当最新报价成功但日线历史接口还没有对应行时，会保存一条最新价格快照。
- 实时价格快照不会被视为已完成的日线市场历史。
- 把区间覆盖保存为 `COMPLETE`、`NO_DATA` 或 `FAILED`。已有价格行和上市前等有效无数据日期不会再次请求。
- 按日期从新到旧请求缺失区间。默认每次运行对所有资产最多发出 40 个历史请求，最长运行 10 分钟。
- 失败日期使用 1 到 24 小时的指数退避；限流错误等待 15 分钟。单资产 Retry 可以跳过一次等待。
- J-Quants 请求间隔为 12.5 秒，以适配免费范围的速率限制。
- 对不同数据源限制请求区间大小，在资产之间加入短暂延迟，并在限流要求时停止剩余工作。

历史边界中的“今天”会根据资产使用不同含义：

- 日本股票使用最近一个已完成的东京市场日期。
- 美股和黄金使用最近一个已完成的纽约市场交易日。
- 基金使用已知的最新 NAV 公布日期。
- MMF 使用 SBI 交易 CSV 中导入价格的日期。

预期历史日期会排除周末以及已知的日本/美国市场休市日。Price Update 表会显示数据源价格日期、已完成历史范围、实时快照日期、待处理交易日数量、下次重试时间和已保存覆盖区间。

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

近期股票和黄金价格历史使用 Yahoo 兼容图表数据。配置 `JQUANTS_API_KEY` 后，较旧的日本股票历史使用官方 J-Quants API。黄金 JPY/gram 历史还依赖 USD/JPY 图表数据。基金价格历史使用 Yahoo Japan 前端基金历史接口和短期页面 token。该基金接口不是公开文档 API，因此只应视为本地个人使用的 best-effort 数据源。

如果 Yahoo 更改 token、接口或响应格式，历史回填可能失败。应用会显示清晰的获取错误，并且仍可使用最新价格快照作为 fallback。

## 交易图表

交易图表支持显示：

- 1 个月
- 6 个月
- 1 年
- 全部数据

X 轴可以按周、月或年显示标签。范围小于全部数据时，可以用 Previous/Next 翻页查看可见窗口。

交易历史表中的 BUY/SELL 按日期倒序显示。

可用技术指标：

- SMA 20、SMA 50、SMA 200
- Bollinger Bands 20/2
- 带 30/70 参考线的 RSI 14
- 带信号线和柱状图的 MACD 12/26/9
- 20 日年化已实现波动率、52 周最高/最低价和回撤摘要

指标在本地使用已保存的日收盘价计算。已完成历史不足时，相应指标不会显示。货币市场基金的导入 NAV 较稳定，无法提供有意义的技术信号，因此会被排除。

## 测试

```powershell
npm test
```

当前测试覆盖：

- 登录认证和应用版本连接
- 报告日期、东京市场日期、纽约市场日期、基金公布日期和 MMF 日期域
- 日本和美国市场交易日及休市日
- 区间覆盖标准化、缺失窗口选择、无数据分类和重试退避
- Price Update 页面路由和操作
- 投资组合 FIFO、MMF、收入、FX 换算、每日变化和混合资产摘要计算
- 股票、基金、美股、配当/分配、FX、黄金、Yahoo 和 J-Quants 解析辅助函数
- 包含价格历史覆盖的 SQLite 存储
- SMA、Bollinger Bands、RSI、MACD、波动率和 52 周指标
- 每日报告快照和多语言 ChatGPT prompt
- 交易图表的数据源优先级、标记和日期倒序历史
- 月度/年度合并历史和期间 Detail 归因

## 许可证

ISC License。见 `LICENSE`。
