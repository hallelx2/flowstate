#!/usr/bin/env node
/**
 * build-icons.mjs — render the master icon.svg into the raster formats
 * Electron + the OS taskbars actually accept.
 *
 *   public/icon.svg   →   public/icon.png       (256×256 — generic + Linux)
 *                          public/icon@2x.png    (512×512 — high-DPI)
 *                          public/icon.ico       (multi-resolution Windows)
 *                          public/icons/<size>.png (intermediates, kept for ICO)
 *
 * Usage:
 *   pnpm --filter @flowstate/desktop icons
 *
 * macOS .icns isn't generated here — `electron-builder` will build it from
 * the 512×512 PNG at packaging time, which is the cleanest path. If you
 * need a hand-rolled .icns for testing, run:
 *
 *   iconutil -c icns public/icon.iconset
 *
 * after creating an `icon.iconset/` directory with the standard sizes.
 *
 * The script is idempotent — re-running just overwrites the outputs.
 */

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const publicDir = join(projectRoot, 'public');
const intermediatesDir = join(publicDir, 'icons');

const SVG_PATH = join(publicDir, 'icon.svg');
const PNG_PATH = join(publicDir, 'icon.png');
const PNG_2X_PATH = join(publicDir, 'icon@2x.png');
const ICO_PATH = join(publicDir, 'icon.ico');

/**
 * Sizes baked into the .ico. Windows picks whichever size best fits the
 * surface (16 = system tray, 32 = title bar, 48 = explorer thumbnail,
 * 64/128/256 = task switcher / start menu / pinned icons).
 */
const ICO_SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  if (!existsSync(SVG_PATH)) {
    throw new Error(`Master SVG not found at ${SVG_PATH}`);
  }

  const svgBuffer = await readFile(SVG_PATH);

  // Wipe + recreate the intermediates dir so we never inherit stale sizes.
  if (existsSync(intermediatesDir)) {
    await rm(intermediatesDir, { recursive: true, force: true });
  }
  await mkdir(intermediatesDir, { recursive: true });

  // 1. Render every size we need into PNG buffers.
  //    `density: 384` gives sharp's librsvg backend enough headroom to
  //    rasterize the 64-viewBox SVG sharply at 256+ pixels without aliasing.
  const buffers = await Promise.all(
    ICO_SIZES.map(async (size) => {
      const buf = await sharp(svgBuffer, { density: 384 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(join(intermediatesDir, `${size}.png`), buf);
      return { size, buf };
    }),
  );

  // 2. Pick the 256 buffer as the canonical PNG (Linux + dev fallback).
  const png256 = buffers.find((b) => b.size === 256)?.buf;
  if (!png256) throw new Error('Internal: 256px buffer missing');
  await writeFile(PNG_PATH, png256);

  // 3. Render a 2× (512) for high-DPI surfaces — macOS Retina + Windows 2× scaling.
  const png512 = await sharp(svgBuffer, { density: 768 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(PNG_2X_PATH, png512);

  // 4. Pack the per-size PNGs into a multi-resolution .ico.
  const icoBuffer = await pngToIco(buffers.map((b) => join(intermediatesDir, `${b.size}.png`)));
  await writeFile(ICO_PATH, icoBuffer);

  // ─── Report ─────────────────────────────────────────────────────────
  const fmt = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log('flowstate icons built:');
  console.log(`  ${PNG_PATH}   (${fmt(png256.length)})`);
  console.log(`  ${PNG_2X_PATH}   (${fmt(png512.length)})`);
  console.log(`  ${ICO_PATH}   (${fmt(icoBuffer.length)})  · sizes: ${ICO_SIZES.join(', ')}`);
  console.log(`  ${intermediatesDir}/   (kept for ICO source — safe to delete after build)`);
}

main().catch((err) => {
  console.error('[icons] failed:', err);
  process.exit(1);
});
