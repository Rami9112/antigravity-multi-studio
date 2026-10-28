import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..', '..');

let cachedLogoBuffer: Buffer | null = null;
let cachedFaviconBuffer: Buffer | null = null;

export function getLogoPngBuffer(): Buffer {
  if (!cachedLogoBuffer) {
    const logoPath = path.join(projectRoot, 'assets', 'logo.png');
    cachedLogoBuffer = fs.readFileSync(logoPath);
  }
  return cachedLogoBuffer;
}

export function getFaviconPngBuffer(): Buffer {
  if (!cachedFaviconBuffer) {
    const faviconPath = path.join(projectRoot, 'assets', 'favicon.png');
    cachedFaviconBuffer = fs.existsSync(faviconPath)
      ? fs.readFileSync(faviconPath)
      : getLogoPngBuffer();
  }
  return cachedFaviconBuffer;
}

export function getInlineLogoImgHtml(size = 44, alt = 'Anti-Multi Studio'): string {
  const radius = Math.round(size * 0.22);
  return `<img src="/logo.png" width="${size}" height="${size}" alt="${alt}" style="display:inline-block;width:${size}px;height:${size}px;border-radius:${radius}px;object-fit:contain;vertical-align:middle;" />`;
}
