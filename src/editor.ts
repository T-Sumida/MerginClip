import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import DOMPurify from 'dompurify';
import { imageDestination, safeImageUrl } from './url';

const SafeImage = Image.extend({
  parseMarkdown(token, helpers) {
    return safeImageUrl(token.href ?? '') ? helpers.createNode('image', { src: token.href, alt: token.text, title: token.title }) : [];
  },
  renderMarkdown(node) {
    const src = String(node.attrs?.src ?? '');
    const alt = String(node.attrs?.alt ?? '').replace(/[\\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
    const title = String(node.attrs?.title ?? '').replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, ' ');
    return `![${alt}](<${imageDestination(src)}>${title ? ` "${title}"` : ''})`;
  },
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: element => safeImageUrl((element as HTMLImageElement).getAttribute('src') ?? '') ? null : false }];
  },
  addInputRules() { return []; },
});

const SafeLink = Link.extend({
  parseMarkdown(token, helpers) {
    const content = helpers.parseInline(token.tokens || []);
    return /^https?:\/\//i.test(token.href ?? '') ? helpers.applyMark('link', content, { href: token.href, title: token.title || null }) : content;
  },
});

export function editorExtensions() {
  return [
    StarterKit.configure({ underline: false, link: false }),
    SafeLink.configure({ openOnClick: false, protocols: ['http', 'https'], autolink: true, defaultProtocol: 'https', isAllowedUri: url => /^https?:\/\//i.test(url) }),
    SafeImage.configure({ allowBase64: true }),
    Placeholder.configure({ placeholder: '気になったことを、ここに。\nMarkdownや画像もそのまま貼り付けられます。' }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}

interface EditorOptions {
  element: HTMLElement;
  doc: JSONContent;
  onUpdate: (editor: Editor) => void;
  onSelection: (editor: Editor) => void;
  onImages: (files: File[], position?: number) => void;
}

export function createNoteEditor(options: EditorOptions): Editor {
  const editor = new Editor({
    element: options.element,
    extensions: editorExtensions(),
    content: options.doc,
    editorProps: {
      attributes: { 'aria-label': 'Markdownメモ', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' },
      transformPastedHTML: html => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_ATTR: ['style', 'srcset'] }),
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.items ?? [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
        if (files.length) { options.onImages(files); return true; }
        const text = event.clipboardData?.getData('text/plain') || '';
        const html = event.clipboardData?.getData('text/html');
        if (text && !html && /(^|\n)(#{1,6} |[-*] |\d+\. |>|```)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/.test(text)) {
          editor.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files.length) return false;
        const files = [...event.dataTransfer.files];
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        options.onImages(files, position);
        return true;
      },
    },
    onUpdate: ({ editor }) => options.onUpdate(editor),
    onSelectionUpdate: ({ editor }) => options.onSelection(editor),
  });
  return editor;
}
