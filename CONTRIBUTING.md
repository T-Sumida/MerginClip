# コントリビューション

MarginClipへの不具合報告、改善提案、ドキュメント修正、Pull Requestを歓迎します。日本語・英語のどちらでも構いません。[行動規範](CODE_OF_CONDUCT.md)に沿って参加してください。

## Issueを作成する

[Issues](https://github.com/T-Sumida/MerginClip/issues)のテンプレートを使い、不具合にはChrome・OS・拡張のバージョン、再現手順、期待した動作と実際の動作を添えてください。大きな機能変更は、実装前にIssueで用途と案を共有すると認識を揃えやすくなります。

実際のメモ、認証情報、個人情報を含むページURLやバックアップを投稿しないでください。再現には公開ページや架空のデータを使えます。脆弱性は[SECURITY](SECURITY.md)の手順で報告してください。

## 開発環境

Node.js 24、npm、Git、Google Chromeを使用します。リポジトリをforkしてcloneし、次を実行します。

```sh
npm ci
npm run build
```

`dist/` をChromeに読み込む手順は[インストールガイド](docs/installation.md)、コマンドの詳細は[開発ガイド](docs/development.md)を参照してください。

## Pull Request

1. 変更の目的が伝わるブランチを作成します。
2. 一つの目的に絞って変更し、不具合修正には再発を検出できるテストを追加します。
3. 振る舞いの変更はガイドと[変更履歴](CHANGELOG.md)のUnreleasedへ反映します。
4. 下記のチェックを実行し、PRに結果と未確認の範囲を書きます。
5. PRテンプレートに沿って、問題・変更後の動作・確認方法を説明します。

```sh
npm run check:docs
npm test
npm run build
npm run test:e2e
```

まとめて実行する場合は `npm run check` を使えます。ドキュメントのみの変更は `npm run check:docs` でリンクを確認してください。ブラウザテストの準備と手動確認項目は[テスト・検証](docs/testing.md)にあります。

依存関係を変更したら `package-lock.json` も更新してください。生成物の `dist/`・`release/`、テスト結果、個人のメモやバックアップはコミット対象に含めません。

## 設計の方針

- メモをローカルに保存し、外部通信や権限を増やす変更は理由を説明する。
- URLごとのメモと、同時編集時のデータを守る。
- 記事の画像は元URLを維持し、メモ画像の書き出しとは区別する。
- 日本語のUI・ドキュメントを揃え、失敗時に次の操作が分かる案内をする。

[アーキテクチャ](docs/architecture.md)には保存形式と各モジュールの責務をまとめています。

## ライセンス

提出する変更はプロジェクトの[MIT License](LICENSE)の下で扱います。第三者のコードや素材を追加する場合は出典とライセンスを確認し、必要な表示を配布物へ含めてください。
