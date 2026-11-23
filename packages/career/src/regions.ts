// The game world's regions (the four VCT international leagues) and how a country code from the
// dataset maps onto a region and onto a name culture (which name-part pool a generated person's
// name is drawn from). Country codes are the dataset's lowercase ISO-3166 alpha-2 codes, plus the
// team-level pseudo-codes "eu" (a European org) and "un" (unknown).

export type Region = "americas" | "emea" | "pacific" | "china";
export const REGIONS: readonly Region[] = ["americas", "emea", "pacific", "china"];

const AMERICAS = ["us", "ca", "br", "ar", "cl", "co", "mx", "pe", "uy", "ve", "ec", "bo", "py", "cr", "gt", "do", "pr", "pa"];
const PACIFIC = ["kr", "jp", "th", "ph", "id", "sg", "my", "vn", "kh", "in", "au", "nz", "pk", "bd", "mn", "la", "mm", "lk", "np"];
const CHINA = ["cn", "hk", "tw", "mo"];

/** Region of a country code. Everything not in Americas / Pacific / China plays in EMEA. */
export function regionOf(country: string | null | undefined): Region {
  const c = (country ?? "").toLowerCase();
  if (CHINA.includes(c)) return "china";
  if (PACIFIC.includes(c)) return "pacific";
  if (AMERICAS.includes(c)) return "americas";
  return "emea";
}

/** Name cultures — one name-part pool each (names.ts). */
export type Culture =
  | "korean" | "japanese" | "chinese" | "thai" | "filipino" | "indonesian" | "vietnamese"
  | "portuguese" | "spanish" | "english" | "turkish" | "slavic" | "central" | "nordic"
  | "romance" | "arabic";

const CULTURE_BY_COUNTRY: Record<string, Culture> = {
  kr: "korean", jp: "japanese",
  cn: "chinese", hk: "chinese", tw: "chinese", mo: "chinese", sg: "chinese", my: "indonesian",
  th: "thai", kh: "thai", la: "thai", mm: "thai",
  ph: "filipino", id: "indonesian", vn: "vietnamese",
  br: "portuguese", pt: "portuguese",
  ar: "spanish", cl: "spanish", co: "spanish", mx: "spanish", pe: "spanish", es: "spanish", uy: "spanish", ve: "spanish", ec: "spanish",
  us: "english", ca: "english", gb: "english", au: "english", nz: "english", ie: "english", in: "english",
  tr: "turkish",
  ru: "slavic", ua: "slavic", by: "slavic", kz: "slavic", kg: "slavic", md: "slavic", rs: "slavic", bg: "slavic", mk: "slavic", hr: "slavic", uz: "slavic",
  pl: "central", cz: "central", sk: "central", de: "central", at: "central", ch: "central", hu: "central", ro: "central", si: "central",
  fi: "nordic", se: "nordic", no: "nordic", dk: "nordic", lt: "nordic", lv: "nordic", ee: "nordic", is: "nordic",
  fr: "romance", be: "romance", nl: "romance", it: "romance", lu: "romance",
  ma: "arabic", eg: "arabic", sa: "arabic", ae: "arabic", dz: "arabic", tn: "arabic", jo: "arabic", lb: "arabic", kw: "arabic", qa: "arabic",
};

/** Default culture of a region, for countries with no culture entry. */
const REGION_CULTURE: Record<Region, Culture> = { americas: "english", emea: "central", pacific: "filipino", china: "chinese" };

export function cultureOf(country: string | null | undefined): Culture {
  const c = (country ?? "").toLowerCase();
  return CULTURE_BY_COUNTRY[c] ?? REGION_CULTURE[regionOf(c)];
}
