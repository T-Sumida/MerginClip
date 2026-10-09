# リリース手順

[ドキュメント一覧](README.md) · [変更履歴](../CHANGELOG.md)

この手順はメンテナーが配布ZIPを作り、GitHub Releasesへ公開するためのものです。ソースの公開、GitHub Releasesへのアップロード、Chrome Web Storeへの登録はそれぞれ別の操作です。CIは自動公開しません。

## バージョンと変更履歴

1. `package.json` と `public/manifest.json` の `version` を同じ値へ更新します。
2. `npm install --package-lock-only --ignore-scripts` でlockfileのプロジェクト情報を更新します。
3. `CHANGELOG.md` のUnreleasedをリリース対象のバージョンと公開日に変更し、新しいUnreleased欄を用意します。
4. 変更内容に合わせて利用・権限・開発ドキュメントを更新します。

最初のバージョンは `0.1.0` です。まだ公開していない変更をリリース済みとして記録しないでください。

## チェックとパッケージ生成

```sh
npm ci
npm run check
npm run package
```

ブラウザの準備は[テスト・検証](testing.md)を参照してください。既知の依存脆弱性は `npm audit` でも確認し、影響を評価します。

生成物は `release/MarginClip-<version>.zip` です。バージョンはpackageとmanifestの一致を確認してから使用します。

```text
MarginClip-<version>.zip
├── MarginClip/          Chromeに読み込むフォルダ
│   ├── manifest.json
│   ├── LICENSE
│   ├── THIRD_PARTY_NOTICES.txt
│   └── ...              パネル・スクリプト・アイコン
├── インストール方法.txt
└── docs/                インストール・利用・プライバシーのガイド
```

記事・メモを保存するZIPとは別の配布物です。配布ZIPには利用者向けドキュメントとライセンスを同梱します。ソースや生成済みのZIPに個人のメモ、認証情報、テストプロファイルが入っていないことを確認してください。

[手動確認](testing.md#リリース前の手動確認)も実施し、ZIPを展開して中の `MarginClip` フォルダからインストールできることを確認します。

## GitHubで公開する

1. 公開するコミットでCIが成功し、変更履歴とZIPのバージョンが一致していることを確認します。
2. リポジトリの概要とトピックを設定し、必要に応じてSettingsで公開範囲をPublicに変更します。
3. Settingsのセキュリティ設定で非公開の脆弱性報告を有効にし、[SECURITY](../SECURITY.md)の案内が利用できることを確認します。
4. 対象コミットへ `v<version>` タグを付け、GitHub Releasesでリリースを作成します。
5. 変更履歴をもとにリリースノートを書き、`MarginClip-<version>.zip` を添付して公開します。
6. 公開ページからZIPをダウンロードし、導入手順とファイルを確認します。

GitHubの自動生成する「Source code」ZIPはビルド済み拡張ではありません。リリースノートには添付した配布ZIPを使うよう案内してください。

Chrome Web Storeで配布する場合は、ストア用パッケージ、説明、プライバシー情報、審査対応が別途必要です。このリリース手順はGitHubでの手動読み込み用ZIP配布を対象にしています。
