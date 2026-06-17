# SBI Portfolio Tracker

[English](README.md) | [中文](README.zh.md) | [日本語](README.ja.md)

SBI証券のCSVファイルを取り込み、ポートフォリオの保有状況、実現/未実現損益、価格履歴、FX取引、金の保有状況を確認するためのローカルNode.js Webアプリです。

このアプリは個人分析用です。税務ソフトではなく、税務申告に関する判断や保証は行いません。

## 機能

- SBIの国内株式と投資信託の取引CSVを取り込み。
- SBIの米国株式の入出金・交割記録を取り込み。
- SBIのFX決済CSVを取り込み。
- SBIの金注文CSVを詳細な `GOLD_JPY` 取引行として取り込み。
- SQLiteにローカル保存。
- 株式と投資信託を同じダッシュボードで計算。
- FIFOで実現損益と残存コストを計算。
- 日本株、米国株、マッピング済み投資信託、金の最新価格を更新。
- 株式、投資信託、金の日次価格履歴を保存してチャート表示。
- 米国株の円建て評価用にUSD/JPYレートを保存。
- 時価評価額、未実現損益、実現損益、日次損益、構成比を含むポートフォリオサマリーを表示。
- ページング付きの取引一覧を表示。
- 保存済み価格履歴と売買マーカー付きの取引チャートを表示。

## 必要環境

- Node.js
- npm

アプリは `sqlite3` パッケージ経由でSQLiteを使用します。データはデフォルトで次に保存されます。

```text
data/sbi-portfolio-tracker.sqlite
```

データベースファイルはGitでは管理しません。

## セットアップ

```powershell
npm install
npm start
```

デフォルトではポート `80` で起動します。

開くURL：

```text
http://localhost/
```

## ログイン

ポートフォリオ画面はシンプルなパスワードログインとHTTP-only JWT cookieで保護されます。

起動前に次の環境変数を設定できます。

```powershell
$env:SBI_AUTH_PASSWORD="change-this-password"
$env:SBI_JWT_SECRET="change-this-long-random-secret"
npm start
```

未設定の場合、ローカル開発用のデフォルトパスワードは次です。

```text
admin
```

## Docker

Dockerイメージはマルチステージの `node:24-alpine` ビルドを使用しています。これにより、脆弱性スキャンでよく検出されるDebianのPerlパッケージをランタイムイメージから避けます。

Docker Hub：

```text
https://hub.docker.com/r/iriyano/sbi-portfolio-tracker
```

イメージをビルド：

```powershell
docker build -t sbi-portfolio-tracker .
```

永続化SQLiteデータボリュームとログイン設定を指定して実行：

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret sbi-portfolio-tracker
```

公開済みイメージを実行：

```powershell
docker run --rm -p 8080:80 -v sbi-portfolio-data:/app/data -e SBI_AUTH_PASSWORD=change-this-password -e SBI_JWT_SECRET=change-this-long-random-secret iriyano/sbi-portfolio-tracker
```

開くURL：

```text
http://localhost:8080/
```

## 主なページ

- `/import` - SBIの取引、FX、金CSVファイルをアップロード。
- `/transactions` - 取り込み済みの正規化取引を表示。
- `/summary` - ポートフォリオサマリーを表示し、価格を更新。
- `/trade-chart` - 売買マーカー付きの価格履歴チャートを表示。

## 取り込みメモ

インポーターは次のように正規化します。

- 日本株は `7974.T` のようなシンボル
- 米国株は `NVDA` のようなシンボル
- 投資信託はカスタムのファンドシンボル
- 金は `GOLD_JPY`

金CSVの取り込みでは集計メタデータを `gold_holdings` に保存し、約定済みの各金注文も通常の `transactions` テーブルへ取り込みます。詳細な取引行は、サマリーのFIFO、取引チャートの買付マーカー、金価格履歴の更新に使われます。旧式の手動金入力フォームは削除済みです。

SBI CSVには正確な約定時刻がなく、日付のみの場合があります。アプリは安定した並び順のために次の合成時刻を割り当てます。

- BUY は `09:00:00`
- SELL は `15:00:00`

これにより、同日売買のFIFO処理を安定させます。

## 価格更新

`/summary` で `Update Prices` を押します。

現在の動作：

- ネット数量がゼロの資産はスキップ。
- Yahoo互換のチャートデータから株式の最新価格を取得。
- 投資信託はマッピングURL/コードが保存されている場合のみ価格を取得。
- 金価格を取得して円/グラムへ変換。
- 株式の日次OHLC価格履歴を保存。
- マッピング済み投資信託のNAV履歴を保存。チャート用には1万口あたりで保存し、サマリー評価では単価へ戻します。
- `GC=F` 金先物と `JPY=X` USD/JPYを組み合わせ、各日付の金価格を円/グラムとして保存。
- 最新価格の取得に成功したものの、日次履歴エンドポイントにまだ行がない場合は最新価格スナップショットを保存。
- 1回のクリックで最大30日分の価格履歴ウィンドウを取得。
- 価格履歴は保有中の株式、投資信託、金の最古BUY日から開始。
- 資産ごとのリクエスト間に遅延を入れ、レート制限時は停止。

米国株では、必要に応じてチャート比較日を米国市場日へずらします。一方、元のSBI取引日は表に表示され続けます。

日次損益は、現在の円建て時価評価額と前回保存済みの価格履歴日を比較します。これにより、週末、休場日、投資信託NAVの遅延による不自然な空白を避けます。

## データソースに関する注意

株式と金の価格履歴はYahoo互換のチャートデータを使用します。金の円/グラム履歴はUSD/JPYチャートデータにも依存します。投資信託の価格履歴は、Yahoo Japanフロントエンドのファンド履歴エンドポイントと短期ページトークンを使用します。このファンドエンドポイントは公式公開APIではないため、ローカル個人利用向けのベストエフォートとして扱ってください。

Yahooがトークン、エンドポイント、レスポンス形式を変更した場合、履歴のバックフィルは失敗する可能性があります。アプリは明確な取得エラーを表示し、最新価格スナップショットをフォールバックとして使えます。

## 取引チャート

取引チャートは次の範囲を表示できます。

- 1か月
- 6か月
- 1年
- 全期間

X軸ラベルは週次、月次、年次にできます。全期間より短い範囲では、Previous/Nextで表示ウィンドウを移動できます。

## テスト

```powershell
npm test
```

現在のテスト対象：

- ポートフォリオFIFOサマリー計算
- 株式、投資信託、米国株、FX、金の解析ヘルパー
- SQLiteストレージアダプターの動作
- 取引チャートデータの準備

## ライセンス

ISC License。`LICENSE` を参照してください。
