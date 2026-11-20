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
  // navigation debug view (developer): the floor, a path by its route preference, and its events
  navFloor: 0x3fa7ff,
  navDrop: 0xffa24a,
  navLink: 0xff6ad5,
  navFastest: 0x6ab7ff,
  navSafest: 0x7bd88f,
  navStealth: 0xc792ea,
  navTactical: 0xf2d95c,
  navTrail: 0xece8e1,
  navReplan: 0xffa24a,
  navOk: 0x7bd88f,
} as const;

export const FONT = '"DIN Condensed","Bahnschrift SemiCondensed","Roboto Condensed","Arial Narrow","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
