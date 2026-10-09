export function pageKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function safeFilename(value: string): string {
  const cleaned = Array.from(value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim()).slice(0, 70).join('').replace(/[. ]+$/g, '');
  const name = cleaned || 'untitled';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}

export function safeImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value);
}

export function imageDestination(value: string): string {
  return value.replace(/[<>\s]/g, char => encodeURIComponent(char));
}
