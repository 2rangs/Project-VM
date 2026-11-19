// Colours shared by the PixiJS stage (numbers) and matchday.css (the same values as CSS vars).
// Ally teal vs enemy red follows the tactical-shooter HUD convention; because that pair is weak
// for red-green colour-blind viewers on hue alone, the two also differ strongly in lightness and
// every marker is shape-coded (ally = circle, enemy = diamond, sound = ring, spike = hexagon).
export const C = {
  bg: 0x0f1923,
  ink: 0xece8e1,
  muted: 0x7e8a94,
  line: 0x2c3a47,
  ally: 0x4be3c9,
  allyDeep: 0x147a6c,
  enemy: 0xff4655,
  enemyDeep: 0x8f1f2b,
  sound: 0xf2d95c,
  spike: 0xffffff,
  dead: 0x5b6670,
} as const;

export const FONT = '"DIN Condensed","Bahnschrift SemiCondensed","Roboto Condensed","Arial Narrow","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
