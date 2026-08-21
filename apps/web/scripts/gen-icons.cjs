const sharp = require(String.raw`C:\Users\ADMIN\Desktop\Alkens\AlkenFinishes\node_modules\sharp`);
const path = require('node:path');

const OUT = String.raw`C:\Users\ADMIN\Desktop\Alkens\AlkenFinishes\apps\web\public`;

const MARK = `<path d="M7.5 24 16 7l8.5 17h-4.7L16 15.8 12.2 24Z" fill="#f47a21"/><rect x="13.7" y="20.2" width="4.6" height="1.8" rx="0.6" fill="#14284a"/>`;

// purpose "any": keeps the rounded-square silhouette the favicon already has.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#14284a"/>${MARK}</svg>`;

// purpose "maskable" and iOS: full bleed. The launcher applies its own mask, so
// a shape baked into the artwork gets clipped a second time and reads wrong.
// The mark already sits inside the 80% safe circle (its far corner is 11.7 of
// the 12.8 radius), so no rescaling is needed — only the corner rounding goes.
const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#14284a"/>${MARK}</svg>`;

const jobs = [
  ['pwa-192.png', rounded, 192],
  ['pwa-512.png', rounded, 512],
  ['maskable-512.png', bleed, 512],
  ['apple-touch-icon.png', bleed, 180],
];

(async () => {
  for (const [name, svg, size] of jobs) {
    const file = path.join(OUT, name);
    await sharp(Buffer.from(svg), { density: 640 })
      .resize(size, size, { fit: 'contain' })
      .png({ compressionLevel: 9 })
      .toFile(file);
    console.log('wrote', name, size + 'x' + size);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
