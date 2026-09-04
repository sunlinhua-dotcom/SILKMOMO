#!/usr/bin/env node
/**
 * 09-04 回退验证的脸/喉部/上胸肤色测量。
 * 口径复用 verify-0904-本人还原/tone/measure.mjs：YCbCr 肤色过滤，按亮度去掉
 * 最暗 25% / 最亮 5%，取各通道中位数，ΔRGB 为三通道差值的 RMS。
 * 脸使用 anchor-compare.json 的右颊窄框以避开金发；喉部与上胸框均避开衣领。
 */
import sharp from 'sharp';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const IMAGE = path.join(ROOT, 'verify-0904-回退验证', 'follow-scene-look.png');
const REFERENCE = path.join(ROOT, 'verify-0904-锚图AB', 'reference_scene.jpeg');
const BOXES = {
  faceRightCheekNarrow: [566, 330, 26, 30],
  throat: [504, 458, 62, 50],
  upperChest: [494, 548, 74, 48],
};
const REFERENCE_BOXES = {
  faceRightCheek: [696, 350, 44, 38],
  throat: [592, 516, 70, 52],
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

async function measure(file, box, visualNote) {
  const value = await sample(file, box);
  return {
    box,
    medianRGB: value.median,
    meanRGB: value.mean,
    luma: value.median ? +lum(value.median).toFixed(1) : null,
    skinPx: value.skinPx,
    boxPx: value.boxPx,
    skinRatio: +(value.skinPx / value.boxPx).toFixed(3),
    visualNote,
  };
}

const samples = {
  faceRightCheekNarrow: await measure(IMAGE, BOXES.faceRightCheekNarrow, '右颊窄框完全落在皮肤上，避开右侧金发。'),
  throat: await measure(IMAGE, BOXES.throat, '喉部中央皮肤，避开两侧头发与下方衣领。'),
  upperChest: await measure(IMAGE, BOXES.upperChest, '上胸中央皮肤，位于衣领上方。'),
};
const referenceSamples = {
  faceRightCheek: await measure(REFERENCE, REFERENCE_BOXES.faceRightCheek, '底图右颊皮肤。'),
  throat: await measure(REFERENCE, REFERENCE_BOXES.throat, '底图喉部唯一干净皮肤框，避开衣领。'),
};

if ([...Object.values(samples), ...Object.values(referenceSamples)].some(value => !value.medianRGB)) {
  throw new Error('One or more sampling boxes contain fewer than 40 skin pixels');
}

const compare = (a, b) => ({
  dRGB: dRGB(a.medianRGB, b.medianRGB),
  dLuma: +(a.luma - b.luma).toFixed(2),
});
const referenceFaceToThroat = compare(referenceSamples.faceRightCheek, referenceSamples.throat);
const plus4Line = +(referenceFaceToThroat.dRGB + 4).toFixed(2);
const comparisons = {
  faceToThroat: compare(samples.faceRightCheekNarrow, samples.throat),
  faceToUpperChest: compare(samples.faceRightCheekNarrow, samples.upperChest),
};
const criterion = {
  rule: 'output ΔRGB <= reference-image face-to-throat ΔRGB + 4',
  referenceFaceToThroat,
  allowance: 4,
  line: plus4Line,
  faceToThroatPass: comparisons.faceToThroat.dRGB <= plus4Line,
  faceToUpperChestPass: comparisons.faceToUpperChest.dRGB <= plus4Line,
  note: '底图上胸框受衣领与下颌投影污染，因此两项都只与底图干净右颊↔喉部的 +4 线比较。',
};

const output = {
  method: 'YCbCr skin filter + drop darkest 25% / brightest 5% by luma + per-channel median; ΔRGB = RMS over RGB channels; Δ亮度 = luma(face) - luma(neck/chest)',
  image: path.relative(ROOT, IMAGE),
  coordinateReview: 'Visual placement only; no identity-similarity judgment.',
  samples,
  comparisons,
  reference: {
    image: path.relative(ROOT, REFERENCE),
    samples: referenceSamples,
  },
  criterion,
};
await writeFile(path.join(HERE, 'tone-results.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log('样本                 框 [left,top,w,h]        RGB 中位数       亮度    肤色像素/总像素');
for (const [name, value] of Object.entries(samples)) {
  console.log(`${name.padEnd(21)} [${value.box.join(',')}]\t[${value.medianRGB.join(',')}]\t${value.luma.toFixed(1)}\t${value.skinPx}/${value.boxPx}`);
}
console.log(`脸↔喉部 ΔRGB ${comparisons.faceToThroat.dRGB.toFixed(2)}，Δ亮度 ${comparisons.faceToThroat.dLuma.toFixed(2)}`);
console.log(`脸↔上胸 ΔRGB ${comparisons.faceToUpperChest.dRGB.toFixed(2)}，Δ亮度 ${comparisons.faceToUpperChest.dLuma.toFixed(2)}`);
console.log(`底图右颊↔喉部 ΔRGB ${referenceFaceToThroat.dRGB.toFixed(2)}，+4 线 ${plus4Line.toFixed(2)}`);

const crop = { left: 400, top: 240, width: 280, height: 440 };
const colors = { faceRightCheekNarrow: '#00e5ff', throat: '#ff3d71', upperChest: '#ffd600' };
const labels = { faceRightCheekNarrow: 'RIGHT CHEEK NARROW', throat: 'THROAT', upperChest: 'UPPER CHEST' };
let marks = '';
for (const [name, box] of Object.entries(BOXES)) {
  const x = box[0] - crop.left;
  const y = box[1] - crop.top;
  marks += `<rect x="${x}" y="${y}" width="${box[2]}" height="${box[3]}" fill="none" stroke="${colors[name]}" stroke-width="3"/>`;
  marks += `<text x="${x}" y="${Math.max(18, y - 5)}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="${colors[name]}">${labels[name]}</text>`;
}
const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}">${marks}</svg>`);
const detail = await sharp(IMAGE).extract(crop).png().toBuffer();
await sharp(detail)
  .composite([{ input: overlay, left: 0, top: 0 }])
  .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
  .toFile(path.join(HERE, 'sampling-spots.jpg'));
console.log('结果 JSON: tone/tone-results.json');
console.log('落点核对图: tone/sampling-spots.jpg（青=右颊窄框，红=喉部，黄=上胸）');
