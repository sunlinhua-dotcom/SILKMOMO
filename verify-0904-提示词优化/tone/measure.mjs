#!/usr/bin/env node
/**
 * 09-04 提示词优化后的脸/喉部/上胸肤色测量。
 * 口径复用 verify-0904-本人还原/tone/measure.mjs：YCbCr 肤色过滤，按亮度去掉
 * 最暗 25% / 最亮 5%，取各通道中位数，ΔRGB 为三通道差值的 RMS。
 */
import sharp from 'sharp';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const IMAGE = path.join(ROOT, 'verify-0904-提示词优化', 'follow-scene-look.png');
const BOXES = {
  face: [452, 317, 42, 38],
  throat: [504, 458, 62, 50],
  upperChest: [494, 548, 74, 48],
};

// ↓↓↓ 与 verify-0904-本人还原/tone/measure.mjs 的测量核心逐字一致 ↓↓↓
function isSkin(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return y > 40 && cb >= 77 && cb <= 132 && cr >= 133 && cr <= 180 && r > g && g > b;
}
const lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

async function sample(file, box) {
  const { data, info } = await sharp(file)
    .extract({ left: box[0], top: box[1], width: box[2], height: box[3] })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  let mean = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3) {
    const p = [data[i], data[i + 1], data[i + 2]];
    mean = [mean[0] + p[0], mean[1] + p[1], mean[2] + p[2]];
    if (isSkin(p[0], p[1], p[2])) px.push([p[0], p[1], p[2], lum(p)]);
  }
  const total = info.width * info.height;
  mean = mean.map(v => +(v / total).toFixed(1));
  if (px.length < 40) return { median: null, mean, skinPx: px.length, boxPx: total };
  px.sort((a, b) => a[3] - b[3]);
  const kept = px.slice(Math.floor(px.length * 0.25), Math.floor(px.length * 0.95));
  const med = c => { const s = kept.map(p => p[c]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { median: [med(0), med(1), med(2)], mean, skinPx: px.length, boxPx: total };
}

const dRGB = (a, b) => +Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / 3).toFixed(2);
// ↑↑↑ 与 verify-0904-本人还原/tone/measure.mjs 的测量核心逐字一致 ↑↑↑

const samples = {};
for (const [name, box] of Object.entries(BOXES)) {
  const value = await sample(IMAGE, box);
  samples[name] = {
    box,
    medianRGB: value.median,
    meanRGB: value.mean,
    luma: value.median ? +lum(value.median).toFixed(1) : null,
    skinPx: value.skinPx,
    boxPx: value.boxPx,
  };
}

if (Object.values(samples).some(sampleValue => !sampleValue.medianRGB)) {
  throw new Error('One or more sampling boxes contain fewer than 40 skin pixels');
}

const comparisons = {
  faceToThroat: {
    dRGB: dRGB(samples.face.medianRGB, samples.throat.medianRGB),
    dLuma: +(samples.face.luma - samples.throat.luma).toFixed(2),
    previous0904: 12.83,
  },
  faceToUpperChest: {
    dRGB: dRGB(samples.face.medianRGB, samples.upperChest.medianRGB),
    dLuma: +(samples.face.luma - samples.upperChest.luma).toFixed(2),
    previous0904Range: [4.8, 7.0],
  },
  baseline0731: { dRGB: 7.05 },
};

const output = {
  method: 'YCbCr skin filter + drop darkest 25% / brightest 5% by luma + per-channel median; ΔRGB = RMS over RGB channels',
  image: path.relative(ROOT, IMAGE),
  samples,
  comparisons,
};
await writeFile(path.join(HERE, 'tone-results.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log('样本       框 [left,top,w,h]        RGB 中位数       亮度    肤色像素/总像素');
for (const [name, value] of Object.entries(samples)) {
  console.log(`${name.padEnd(10)} [${value.box.join(',')}]	[${value.medianRGB.join(',')}]	${value.luma.toFixed(1)}	${value.skinPx}/${value.boxPx}`);
}
console.log(`脸↔喉部 ΔRGB ${comparisons.faceToThroat.dRGB.toFixed(2)}，Δ亮度 ${comparisons.faceToThroat.dLuma.toFixed(2)}`);
console.log(`脸↔上胸 ΔRGB ${comparisons.faceToUpperChest.dRGB.toFixed(2)}，Δ亮度 ${comparisons.faceToUpperChest.dLuma.toFixed(2)}`);

const crop = { left: 350, top: 180, width: 400, height: 500 };
const colors = { face: '#00e5ff', throat: '#ff3d71', upperChest: '#ffd600' };
const labels = { face: 'FACE', throat: 'THROAT', upperChest: 'UPPER CHEST' };
let marks = '';
for (const [name, box] of Object.entries(BOXES)) {
  const x = box[0] - crop.left;
  const y = box[1] - crop.top;
  marks += `<rect x="${x}" y="${y}" width="${box[2]}" height="${box[3]}" fill="none" stroke="${colors[name]}" stroke-width="3"/>`;
  marks += `<text x="${x}" y="${Math.max(18, y - 5)}" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="${colors[name]}">${labels[name]}</text>`;
}
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">${marks}</svg>`);
const detail = await sharp(IMAGE).extract(crop).png().toBuffer();
await sharp(detail)
  .composite([{ input: overlay, left: 0, top: 0 }])
  .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
  .toFile(path.join(HERE, 'sampling-spots.jpg'));
console.log('结果 JSON: tone/tone-results.json');
console.log('落点核对图: tone/sampling-spots.jpg（青=脸，红=喉部，黄=上胸）');
