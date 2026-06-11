# CSV Import and MongoDB Design

The CSV import should not write into the old `posts` collection. That collection belongs to the original personal homepage/Imgur feature.

For SBI Securities data, use a separate MongoDB collection:

```text
database: iriyano
collection: transactions
```

## Why MongoDB Works Here

SBI rows are semi-structured. Stocks and investment funds share many fields, but they are not exactly the same:

- stocks have a normal security code, which becomes `7974.T`
- funds often have no ticker, so the app uses `FUND:<fund name>`
- fund prices may be per 10,000 units
- future CSV exports may add or change columns

MongoDB is a good fit for this first version because each transaction can store:

- normalized fields for calculations
- the original raw CSV row for debugging and audit

## Import Flow

1. User opens `/import`.
2. User uploads an SBI CSV file.
3. The app decodes the file as Shift-JIS.
4. The parser finds the SBI transaction header:

```text
約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益
```

5. Each row is normalized.
6. Rows are upserted into MongoDB by `source + sourceHash`.
7. The user can inspect imported rows at `/transactions`.

## Normalized Document Shape

Example:

```js
{
  source: "SBI",
  sourceFile: "SaveFile_000001_000402.csv",
  sourceHash: "...",
  importedAt: ISODate("..."),
  raw: {
    "約定日": "2024/05/27",
    "銘柄": "ニッセイ日経２２５インデックスファンド",
    "取引": "投信金額買付"
  },
  tradeDate: "2024-05-27",
  tradeTime: "09:00:00",
  tradeDateTime: "2024-05-27T09:00:00",
  settlementDate: "2024-05-31",
  assetName: "ニッセイ日経２２５インデックスファンド",
  assetType: "FUND",
  code: "",
  market: "",
  symbol: "FUND:ニッセイ日経２２５インデックスファンド",
  side: "BUY",
  action: "投信金額買付",
  account: "NISA(成)",
  taxCategory: "",
  quantity: 1044,
  price: 47903,
  unitPrice: 4.7903,
  priceUnit: "PER_10000_UNITS",
  fee: 0,
  tax: 0,
  settlementAmount: 5000
}
```

## Same-Day Buy/Sell Rule

SBI CSV may not include execution time. The app assigns synthetic times:

- `BUY`: `09:00:00`
- `SELL`: `15:00:00`
- `OTHER`: `12:00:00`

This makes same-day buy/sell rows sort in calculation-friendly order.

## Collections For Later

Start with:

```text
transactions
```

Later, add:

```text
assets
prices
imports
```

Suggested use:

- `assets`: one document per stock or fund, with manual display settings and Yahoo Finance Japan URL
- `prices`: current/manual price history
- `imports`: uploaded file metadata and import history

## Current Routes

- `GET /import`: upload form
- `POST /import/sbi`: parse and save CSV rows
- `GET /transactions`: show latest imported transactions

## Next Calculation Step

The next logical feature is a portfolio calculator that reads from `transactions`.

For each `symbol`, process rows sorted by:

```text
tradeDateTime ASC
```

Use FIFO lots:

- BUY adds a lot
- SELL consumes oldest lots first
- realized P/L is sale proceeds minus consumed cost
- remaining lots become current position cost
