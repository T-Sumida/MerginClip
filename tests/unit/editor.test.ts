import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { editorExtensions } from '../../src/editor';

it('renders Markdown and serializes headings, marks, lists, quotes, links, code and images', () => {
  const markdown = '# 読書メモ\n\n**重要** と *補足* と `x`\n\n- 項目1\n- 項目2\n\n1. 手順\n\n> 引用\n\n[参照](https://example.com)\n\n```js\nconst x = 1;\n```\n\n![図](data:image/png;base64,aGVsbG8=)';
  const editor = new Editor({ extensions: editorExtensions(), content: markdown, contentType: 'markdown' });
  expect(editor.getHTML()).toContain('<h1>読書メモ</h1>');
  expect(editor.getHTML()).toContain('<strong>重要</strong>');
  expect(editor.getHTML()).toContain('<blockquote>');
  expect(editor.getHTML()).toContain('<pre>');
  expect(editor.getHTML()).toContain('<img');
  const output = editor.getMarkdown();
  for (const text of ['# 読書メモ', '**重要**', '*補足*', '- 項目1', '1. 手順', '> 引用', '[参照](https://example.com)', '```js', 'data:image/png;base64,aGVsbG8=']) expect(output).toContain(text);
  editor.destroy();
});

it('keeps history isolated when the editor is replaced for another page', () => {
  const a = new Editor({ extensions: editorExtensions(), content: 'ページA', contentType: 'markdown' });
  a.commands.insertContent('追記');
  a.destroy();
  const b = new Editor({ extensions: editorExtensions(), content: 'ページB', contentType: 'markdown' });
  expect(b.can().undo()).toBe(false);
  expect(b.getText()).toBe('ページB');
  b.destroy();
});

it('removes executable URLs from both the rendered document and exported Markdown', () => {
  const editor = new Editor({ extensions: editorExtensions(), content: 'Before [危険](javascript:alert%281%29) ![図](javascript:alert%281%29) After', contentType: 'markdown' });
  expect(editor.getHTML()).not.toContain('javascript:');
  expect(editor.getMarkdown()).not.toContain('javascript:');
  expect(editor.getText()).toContain('危険');
  editor.state.doc.check();
  editor.destroy();
});
