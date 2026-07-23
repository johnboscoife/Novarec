// Rasterizes build/icon.svg -> build/icon.png (1024). electron-builder then
// generates platform icons (.ico/.icns) from that PNG at package time.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const svg = readFileSync(join(build, 'icon.svg'));
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
writeFileSync(join(build, 'icon.png'), png);
console.log('wrote build/icon.png');
