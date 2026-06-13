# SBI Portfolio Tracker

A local Node.js web app for importing SBI Securities CSV files and reviewing portfolio positions, realized/unrealized P/L, price history, FX trades, and gold holdings.

The app is built for personal analysis. It is not tax software and does not make tax-reporting claims.

## Features

- Import SBI domestic stock and investment fund transaction CSV files.
- Import SBI US stock payment records.
- Import SBI FX settlement CSV files.
- Import SBI gold order CSV files.
- Store data locally in SQLite.
- Calculate stock and fund positions together.
- Calculate FIFO realized P/L and remaining cost.
- Refresh latest prices for Japanese stocks, US stocks, mapped funds, and gold.
- Save daily stock price history with open/high/low/close.
- Store USD/JPY FX rates for US stock JPY valuation.
- Show a portfolio summary with market value, unrealized P/L, realized P/L, and allocation percentage.
- Show transaction pages with pagination.
- Show trade charts with saved price history and buy/sell markers.

## Requirements

- Node.js
- npm

The app uses SQLite through the `sqlite3` package. Data is stored locally under:

```text
data/sbi-portfolio-tracker.sqlite
```

The database file is ignored by Git.

## Setup

```powershell
npm install
npm start
```

By default the app listens on port `80`.

Open:

```text
http://localhost/
```

## Main Pages

- `/import` - upload SBI CSV files for transactions, FX, and gold.
- `/transactions` - view imported normalized transactions.
- `/summary` - view portfolio summary and update prices.
- `/trade-chart` - view price history with buy/sell markers.

## Import Notes

The importer normalizes:

- Japanese stocks as symbols like `7974.T`
- US stocks as symbols like `NVDA`
- Investment funds as custom fund symbols
- Gold as `GOLD_JPY`

SBI CSV files often contain only dates, not exact execution times. The app assigns synthetic ordering:

- BUY at `09:00:00`
- SELL at `15:00:00`

This keeps same-day buy/sell FIFO behavior stable.

## Price Refresh

Use `Update Prices` on `/summary`.

Current behavior:

- Skips assets with zero net quantity.
- Fetches latest stock prices from Yahoo-compatible chart data.
- Fetches mapped fund prices only when a fund mapping URL/code is saved.
- Fetches gold price and converts it to JPY per gram.
- Saves stock daily OHLC price history.
- Fetches at most a 30-day price-history window per click.
- Price history starts from the oldest BUY date for each held stock.
- Uses a delay between asset requests and stops on rate limits.

For US stocks, chart comparison dates are shifted to the US market date when needed, while the original SBI transaction date remains visible in tables.

## Trade Chart

The trade chart can show:

- 1 month
- 6 months
- 1 year
- all data

The x-axis can be labeled weekly, monthly, or yearly. For ranges smaller than all data, use Previous/Next to page the visible window.

## Tests

```powershell
npm test
```

Current tests cover:

- portfolio FIFO summary calculations
- stock, fund, US stock, FX, and gold parsing helpers
- SQLite storage adapter behavior
- trade chart data preparation

