/* Sweeps every hue the colour wheel can produce and asserts the derived palette
 * still meets its contrast floors.
 *
 * The point of this file: the wheel lets the researcher pick ANY colour, and a
 * palette that is only checked at the four shades I happened to try is not
 * checked. Pale yellow and neon cyan are the ones that break naive derivation,
 * so they are asserted explicitly at the end.
 *
 * Run: node quiz/tools/palette.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.window = {};
global.document = undefined;
new Function(fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'palette.js'), 'utf8'))
  .call(global);
const P = global.window.QuizPalette;

const FLOORS = { ink: 7.0, 'ink-soft': 4.5, accent: 4.5 };

function ratio(aHex, bHex) {
  const a = P.hexToHsl(aHex), b = P.hexToHsl(bHex);
  return P.contrast(a.h, a.s, a.l, b.h, b.s, b.l);
}

let checked = 0;
const failures = [];
const worst = { ink: [Infinity, null], 'ink-soft': [Infinity, null], accent: [Infinity, null] };

function check(seed) {
  const p = P.build(seed);
  if (!p) { failures.push(`${seed}: build returned null`); return; }
  for (const mode of ['light', 'dark']) {
    const pal = p[mode];
    for (const key of Object.keys(FLOORS)) {
      const r = ratio(pal[key], pal.bg);
      checked++;
      if (r < worst[key][0]) worst[key] = [r, `${seed} ${mode}`];
      if (r < FLOORS[key]) {
        failures.push(`${seed} ${mode}: ${key} on bg = ${r.toFixed(2)} (need ${FLOORS[key]})`);
      }
    }
    // The accent must also stay distinguishable from its own tinted chip,
    // or the eyebrow text vanishes into .accent-bg.
    const chip = ratio(pal.accent, pal['accent-bg']);
    checked++;
    if (chip < 3.0) {
      failures.push(`${seed} ${mode}: accent on accent-bg = ${chip.toFixed(2)} (need 3.0)`);
    }
  }
}

// Every hue, at saturations and lightnesses a colour wheel actually yields.
for (let h = 0; h < 360; h += 5) {
  for (const s of [10, 35, 60, 85, 100]) {
    for (const l of [25, 50, 75, 92]) {
      check(P.hex(h, s, l));
    }
  }
}

// The ones that break naive derivation.
const NASTY = {
  '#ffff00': 'pure yellow — max lightness at max saturation',
  '#00ffff': 'neon cyan — very light despite full saturation',
  '#ffffff': 'white — no hue, no saturation',
  '#000000': 'black — no hue, no saturation',
  '#808080': 'mid grey — zero saturation',
  '#f5f5dc': 'beige — pale and desaturated',
  '#0000ff': 'pure blue — very dark at full saturation',
  '#8d3f66': 'the current rose, as a regression check',
};
for (const seed of Object.keys(NASTY)) check(seed);

console.log(`${checked} contrast assertions across ${360 / 5 * 5 * 4 + Object.keys(NASTY).length} seeds\n`);
console.log('tightest margins:');
for (const k of Object.keys(worst)) {
  console.log(`  ${k.padEnd(9)} ${worst[k][0].toFixed(2)}  (floor ${FLOORS[k]}, at ${worst[k][1]})`);
}

console.log('\nnasty seeds:');
for (const seed of Object.keys(NASTY)) {
  const p = P.build(seed);
  const li = ratio(p.light.ink, p.light.bg), la = ratio(p.light.accent, p.light.bg);
  const di = ratio(p.dark.ink, p.dark.bg), da = ratio(p.dark.accent, p.dark.bg);
  console.log(`  ${seed}  light ink ${li.toFixed(1)} accent ${la.toFixed(1)}` +
              ` | dark ink ${di.toFixed(1)} accent ${da.toFixed(1)}   ${NASTY[seed]}`);
}

if (failures.length) {
  console.log(`\n${failures.length} FAILURES:`);
  for (const f of failures.slice(0, 15)) console.log('  ' + f);
  process.exit(1);
}
console.log('\nall palettes meet their contrast floors');
