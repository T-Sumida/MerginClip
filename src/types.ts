import type { JSONContent } from '@tiptap/core';

export interface Article {
  title: string;
  url: string;
  markdown: string;
  byline: string | null;
  publishedTime: string | null;
  extractedAt: string;
  imageUrls: string[];
  fallback: boolean;
}

export interface Note {
  key: string;
  url: string;
  title: string;
  doc: JSONContent;
  markdown: string;
  updatedAt: string;
  revision: number;
  article: Article | null;
}

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
