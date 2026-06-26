// 安装器位图生成：把源 SVG 渲染为安装器需要的 24-bit BMP。
// 用法（在 HtyBox/ 下）：  node src-tauri/installer/render-bmp.mjs
// 依赖：@resvg/resvg-js（devDependency，自带预编译二进制，无需系统级 ImageMagick/Inkscape）。
//
// NSIS（sidebar/header）按 2× 渲染：MUI 会把位图拉伸到「随 DPI 放大的控件」，
//   给 1× 源会被放大发虚，给 2× 源则改为缩小 → 高分屏上清晰。
// WiX（banner/dialog）按原始尺寸渲染：MSI 要求精确 493×58 / 493×312。
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const jobs = [
  { name: 'sidebar', fitTo: { mode: 'zoom', value: 2 } },     // NSIS 164×314 → 328×628
  { name: 'header',  fitTo: { mode: 'zoom', value: 2 } },     // NSIS 150×57  → 300×114
  { name: 'banner',  fitTo: { mode: 'original' } },           // WiX 493×58（精确）
  { name: 'dialog',  fitTo: { mode: 'original' } },           // WiX 493×312（精确）
];

// RGBA 像素 → 24-bit BMP（BI_RGB，自底向上，行按 4 字节对齐）。
// 半透明像素按白底合成（四张图均为不透明背景，实际只影响边缘抗锯齿）。
function toBMP24(rgba, width, height) {
  const rowSize = width * 3;
  const padding = (4 - (rowSize % 4)) % 4;
  const stride = rowSize + padding;
  const imgSize = stride * height;
  const buf = Buffer.alloc(54 + imgSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54 + imgSize, 2);
  buf.writeUInt32LE(54, 10);          // 像素数据偏移
  buf.writeUInt32LE(40, 14);          // DIB 头大小
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);       // 正值 = 自底向上
  buf.writeUInt16LE(1, 26);           // 平面数
  buf.writeUInt16LE(24, 28);          // 位深
  buf.writeUInt32LE(imgSize, 34);
  buf.writeInt32LE(2835, 38);         // 横向 72dpi（像素/米）
  buf.writeInt32LE(2835, 42);
  let p = 54;
  for (let y = height - 1; y >= 0; y--) {
    let rp = y * width * 4;
    for (let x = 0; x < width; x++) {
      const r = rgba[rp], g = rgba[rp + 1], b = rgba[rp + 2], a = rgba[rp + 3] / 255;
      buf[p++] = Math.round(b * a + 255 * (1 - a));
      buf[p++] = Math.round(g * a + 255 * (1 - a));
      buf[p++] = Math.round(r * a + 255 * (1 - a));
      rp += 4;
    }
    p += padding;
  }
  return buf;
}

for (const job of jobs) {
  const svg = readFileSync(join(here, job.name + '.svg'));
  const img = new Resvg(svg, {
    fitTo: job.fitTo,
    shapeRendering: 2, // geometricPrecision
    textRendering: 2,  // geometricPrecision
  }).render();
  const bmp = toBMP24(img.pixels, img.width, img.height);
  writeFileSync(join(here, job.name + '.bmp'), bmp);
  console.log(`${job.name}.bmp  ${img.width}x${img.height}  ${bmp.length} bytes`);
}
