# CSV Import and SQLite Storage

The portfolio app stores imported SBI data in a local SQLite database:

```text
data/sbi-portfolio-tracker.sqlite
```

The SQLite file is local runtime data and should not be committed.

## Import Flow

1. User opens `/import`.
2. User uploads an SBI, FX, or gold CSV file.
3. The parser normalizes rows into JavaScript objects.
4. The storage layer saves those objects into SQLite.
5. Duplicate transaction imports are prevented by `source + sourceHash`.
6. The user can inspect transactions at `/transactions` and portfolio totals at `/summary`.

## Tables

The app uses these tables:

```text
transactions
fx_trades
gold_holdings
assets
fx_rates
```

Each table stores the normalized object as JSON for compatibility with the existing calculator code. The transaction and FX tables also keep sort/key columns for upsert and pagination.

`fx_rates` stores one row per pair per date. During price refresh, if US stocks are present, the app fetches the last 7 days of daily `USDJPY` candles from Yahoo symbol `JPY=X` and stores the `DAILY_CLOSE` rows. Summary calculations use the latest stored USD/JPY daily close for US stock JPY market value, falling back to the imported trade FX estimate only when no FX rate is available.

## Same-Day Buy/Sell Rule

SBI CSV may not include execution time. The app assigns synthetic times:

- `BUY`: `09:00:00`
- `SELL`: `15:00:00`
- `OTHER`: `12:00:00`

This makes same-day buy/sell rows sort in calculation-friendly order.

## Current Routes

- `GET /import`: upload form
- `POST /import/sbi`: parse and save SBI stock/fund/US stock rows
- `POST /import/fx`: parse and save SBI FX rows
- `POST /import/gold`: parse and save SBI gold rows
- `GET /transactions`: show imported transactions
- `GET /summary`: show portfolio, FX, gold, and price summary

## Fresh Start

There is no MongoDB migration. CSV files are the source of truth, so a user can delete the SQLite file and re-import original CSV files.
