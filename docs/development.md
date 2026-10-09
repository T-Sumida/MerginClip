# 開発ガイド

[ドキュメント一覧](README.md) · [コントリビューション](../CONTRIBUTING.md)

## 環境構築

Node.js 24、npm、Git、Google Chromeを使用します。`.nvmrc` はNode.jsのメジャーバージョンを指定します。依存関係の正確なバージョンは `package-lock.json` で管理します。

```sh
git clone https://github.com/T-Sumida/MerginClip.git
cd MerginClip
npm ci
npm run build
```

生成された `dist/` を[インストールガイド](installation.md)に沿ってChromeへ読み込みます。開発に参加する場合は自分のforkをcloneしてください。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run typecheck` | TypeScriptの型検査 |
| `npm run check:docs` | Markdown内の相対ファイルリンクと画像参照の確認 |
| `npm test` | 単体テスト |
| `npm run build` | 型検査と拡張の本番ビルド |
| `npm run test:e2e` | ビルド済み拡張のブラウザテスト |
| `npm run check` | ドキュメント、単体テスト、ビルド、ブラウザテスト |
| `npm run package` | ビルドと配布ZIP生成 |

ブラウザテストは先にビルドが必要です。ブラウザの準備や確認範囲は[テスト・検証](testing.md)を参照してください。

## 変更を確認する

コードを編集したら `npm run build` を実行し、`chrome://extensions` で拡張を再読み込みしてパネルを開き直します。開発サーバーのページを使うと拡張APIを利用できないため、UIも実際の拡張で確認してください。

メモの消失を避けるため、通常利用のChromeプロファイルとは別のプロファイルで開発することを勧めます。データ構造を変える場合は既存データとバックアップの移行方法も検討してください。

## リポジトリ構成

```text
public/             Manifest V3の設定
src/                サイドパネル、エディタ、保存、抽出、書き出し
scripts/            ビルド、配布、ドキュメント検査、テスト用HTTPサーバー
tests/unit/         単体テスト
tests/e2e/          実ブラウザでの拡張テスト
docs/               利用・開発・配布のガイドと画面画像
.github/            Issue・PRテンプレートとCI
```

`node_modules/`、`dist/`、`release/`、テスト結果はGit管理対象外です。設計やデータの詳細は[アーキテクチャ](architecture.md)にあります。

## CI

GitHub Actionsでドキュメント検査、単体テスト、型検査、本番ビルドを実行します。ブラウザテストはWindowsのChromeで実行します。CIはリポジトリへのpushとPull Requestを対象にし、配布物の公開は行いません。

新しい依存関係を導入するときは、用途・ライセンス・バンドルへの影響を確認してください。既知の脆弱性の確認には `npm audit` を使えます。公開手順は[リリース手順](releasing.md)で管理します。
