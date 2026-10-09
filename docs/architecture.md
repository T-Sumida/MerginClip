# アーキテクチャ

[ドキュメント一覧](README.md) · [開発ガイド](development.md)

## 全体構成

Manifest V3のChrome拡張です。service workerがアイコンとサイドパネルを関連付け、パネルが現在のウィンドウの対象ページを追跡します。記事抽出は必要時に対象タブへコードを注入し、メモはパネルからIndexedDBに保存します。

| ファイル | 責務 |
| --- | --- |
| `public/manifest.json` | 権限、サイドパネル、ショートカット |
| `src/background.ts` | アイコンとサイドパネルの関連付け |
| `src/panel.ts` | 対象ページ、編集・保存・メモ一覧・バックアップのUI |
| `src/editor.ts` | Tiptap / ProseMirror、Markdown、画像と貼り付け |
| `src/db.ts` | IndexedDB、リビジョンによる競合検知、バックアップ検証 |
| `src/extractor.ts` | Readabilityによる本文抽出、HTMLの無害化、Markdown変換 |
| `src/exporter.ts` | 画像参照の処理、ZIP生成、Chromeのダウンロード |
| `src/url.ts` | URLキーと安全なファイル名 |
| `scripts/build.mjs` | パネル・worker・抽出コード・アイコン・ライセンスのビルド |
| `scripts/package.mjs` | 拡張とガイドを配布ZIPへまとめる |

## データモデルと保存

IndexedDB `marginclip`（version 1）の `notes` ストアに、URLキー、元URL、タイトル、エディタJSON、Markdown、更新日時、リビジョン、記事取得結果を保存します。貼り付け画像はdata URLとしてエディタJSONに含めます。型定義は `src/types.ts`、バックアップ検証は `src/db.ts` が管理します。

URLキーはHTTP／HTTPS URLからフラグメントを除いたものです。クエリ、順序、末尾のスラッシュは保持します。追跡用パラメータは自動で削除しません。

エディタの更新ごとに保存をキューへ追加し、readwriteトランザクション完了後に「保存済み」を表示します。ページ切り替え時は画像読み込みと保存の完了を待ってエディタを破棄し、編集履歴を分離します。トランザクション完了前のブラウザ強制終了をまたぐ保存は保証できません。

保存トランザクション内で既存リビジョンと一致するか確認し、別ウィンドウの古い編集による上書きを防ぎます。保存エラー・競合時は編集とページ追従を停止し、手元の編集内容を残して退避操作を提供します。バックアップ復元は全レコードを検証した後、1つのトランザクションで未登録URLだけ追加します。

非同期の抽出結果は世代番号とURLを確認してから反映します。画像貼り付けは読み込み前にエディタと選択位置を固定します。書き出し対象はクリック時のメモを固定します。

## 記事抽出とMarkdown

元ページのDOMを複製し、Readabilityで本文を抽出します。記事を特定できない場合はarticle・main・body領域を使い、警告を表示します。取得HTMLはDOMPurifyで処理し、TurndownでMarkdownへ変換します。タイトル・著者・公開日時の取得にはページのメタ情報やJSON-LDも使用します。

編集はTiptap StarterKitとMarkdownを使う常時整形表示です。表・数式・脚注などすべてのMarkdown記法は対象にせず、基本書式のparse・serializeとブラウザ操作を回帰テストしています。

## 書き出し

記事とメモは独立したMarkdownとして1つのZIPに保存します。名前は `{YYYYMMDD_HHmmss}_{記事タイトル}_{article|note}.md` で、保存開始時のローカル日時を共通で使用します。記事を取得できない場合はメモのページタイトルを使います。ページ情報と保存日時はMarkdownのfrontmatterに記録します。

記事画像は元URLを保持し、ダウンロードしません。メモの貼り付け画像は `assets/` に同梱し、メモのリモート画像は取得可能なものだけ相対参照へ置き換えます。同じURLが記事とメモにある場合も、置き換えはメモ側に限ります。

画像取得は認証・Cookie・リファラーなしで行い、サイズ、枚数、時間、全体サイズに上限を設けます。取得できないリモート画像は元参照を残して警告し、貼り付け画像の同梱失敗は保存エラーにします。上限の値は[ユーザーガイド](user-guide.md#記事とメモを保存)に記載しています。

ZIPはfflateの同期処理で生成します。Manifest V3のCSPで禁止されるblob workerを使わないためです。記事・メモのZIPにREADMEやmetadataファイルは含めません。

## 入力と実行環境

記事HTMLとHTML貼り付けはDOMPurifyで処理し、ページHTMLをパネルのUIとして直接表示しません。リンクはHTTP／HTTPS、メモ画像はHTTP／HTTPSと対応するラスタ画像のdata URLに制限します。SVGはZIP同梱の対象外です。記事のSVG画像参照は元URLを保持します。

抽出コードはChromeのisolated worldで実行します。常駐content scriptやリモートコード、eval、CDNからのライブラリ読み込みは使いません。Manifest V3のCSPでパッケージ内スクリプトを使用します。権限と通信は[プライバシー](privacy.md)を参照してください。

## 利用ライブラリ

| ライブラリ | 用途 | ライセンス |
| --- | --- | --- |
| [Tiptap](https://github.com/ueberdosis/tiptap) / ProseMirror | 編集とMarkdown | MIT |
| [Mozilla Readability](https://github.com/mozilla/readability) | 記事本文の抽出 | Apache-2.0 |
| [DOMPurify](https://github.com/cure53/DOMPurify) | HTMLの無害化 | MPL-2.0 OR Apache-2.0 |
| [Turndown](https://github.com/mixmark-io/turndown) | HTMLからMarkdownへの変換 | MIT |
| [fflate](https://github.com/101arrowz/fflate) | ZIPの生成 | MIT |

実際に使うバージョンは `package-lock.json` で固定します。ビルド時に実行時依存のライセンスを `dist/THIRD_PARTY_NOTICES.txt` へ収集し、プロジェクトの `LICENSE` とともに配布します。

Chrome APIの詳細は[Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)を参照してください。
