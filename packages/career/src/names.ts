// Original name-part pools for generated people. Given names and family names are common,
// generic name parts of each culture (no person is modelled on anyone); full names are random
// combinations. Handles (in-game tags) are built from invented syllables, never from a list of
// real tags, and every generated handle is checked against the reserved set — the real players'
// handles from the dataset plus every handle already in the world — and redrawn on a collision.
import type { Culture } from "./regions.ts";
import { pick, type Rng } from "./rng.ts";

interface NamePool {
  readonly given: readonly string[];
  readonly family: readonly string[];
  /** Family name first (East Asian order). */
  readonly familyFirst?: boolean;
  /** Given names built from two syllables (korean, chinese) instead of a whole-name list. */
  readonly givenSyllables?: readonly [readonly string[], readonly string[]];
}

const POOLS: Record<Culture, NamePool> = {
  korean: {
    familyFirst: true,
    family: ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Yoo", "Hong", "Jeon", "Ko", "Moon", "Bae"],
    given: [],
    givenSyllables: [
      ["Min", "Seo", "Ji", "Hyun", "Jun", "Do", "Ha", "Yeon", "Woo", "Tae", "Soo", "Eun", "Jae", "Sung", "Ye", "Si", "Dong", "Gun"],
      ["jun", "woo", "ho", "hyun", "min", "seok", "bin", "won", "jin", "hoon", "yeol", "gyu", "chan", "in", "su", "hwan", "young"],
    ],
  },
  japanese: {
    familyFirst: false,
    family: ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada", "Sasaki", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Mori", "Ikeda"],
    given: ["Haruto", "Yuto", "Sota", "Riku", "Kaito", "Ren", "Hinata", "Minato", "Takumi", "Kenta", "Daiki", "Shota", "Yuki", "Ryota", "Kazuki", "Sho", "Itsuki", "Hayato", "Kosei", "Tomoya"],
  },
  chinese: {
    familyFirst: true,
    family: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou", "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "He", "Lin", "Gao", "Luo", "Zheng", "Tang"],
    given: [],
    givenSyllables: [
      ["Hao", "Yu", "Zi", "Jun", "Wei", "Xuan", "Ming", "Tian", "Yi", "Chen", "Kai", "Rui", "Bo", "Lei", "Xin", "Hang", "Feng", "Jia"],
      ["yu", "hao", "xuan", "ming", "jie", "lin", "rui", "chen", "yang", "tao", "long", "fan", "kai", "", "", ""],
    ],
  },
  thai: {
    family: ["Srisuk", "Wongsa", "Charoen", "Boonmee", "Thongdee", "Saelim", "Kaewkam", "Rattana", "Sombat", "Chaiyo", "Phromma", "Inthong"],
    given: ["Nattapong", "Kittisak", "Thanakorn", "Chanin", "Sirawit", "Pakorn", "Teerapat", "Phuwadol", "Worawit", "Anan", "Krit", "Pongsakorn", "Thitiwat"],
  },
  filipino: {
    family: ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Mendoza", "Villanueva", "Aquino", "Ramos", "Dela Rosa", "Navarro", "Salazar", "Tolentino"],
    given: ["Miguel", "Rafael", "Joshua", "Andre", "Paolo", "Carlo", "Jerome", "Kenneth", "Mark", "Adrian", "Gabriel", "Nathaniel", "Renz"],
  },
  indonesian: {
    family: ["Pratama", "Saputra", "Wijaya", "Nugroho", "Hidayat", "Setiawan", "Kurniawan", "Santoso", "Gunawan", "Halim", "Firmansyah", "Ramadhan"],
    given: ["Rizky", "Dimas", "Fajar", "Bayu", "Arif", "Gilang", "Aditya", "Yoga", "Reza", "Ilham", "Bima", "Farhan", "Daffa"],
  },
  vietnamese: {
    familyFirst: true,
    family: ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Phan", "Vu", "Dang", "Bui", "Do", "Ho", "Ngo"],
    given: ["Minh", "Khang", "Bao", "Huy", "Phuc", "Quang", "Tuan", "Duc", "Long", "Nam", "Khoa", "Tri", "Hieu"],
  },
  portuguese: {
    family: ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Almeida", "Ribeiro", "Carvalho", "Gomes", "Martins", "Rocha", "Barbosa", "Teixeira", "Moreira", "Cardoso"],
    given: ["Lucas", "Gabriel", "Matheus", "Pedro", "Guilherme", "Rafael", "Vinicius", "Felipe", "Thiago", "Leonardo", "Caio", "Bruno", "Diego", "Rodrigo", "Joao", "Arthur", "Enzo", "Davi"],
  },
  spanish: {
    family: ["Gonzalez", "Rodriguez", "Fernandez", "Lopez", "Martinez", "Perez", "Sanchez", "Romero", "Diaz", "Torres", "Alvarez", "Ruiz", "Vargas", "Castro", "Herrera", "Medina", "Rojas", "Molina"],
    given: ["Mateo", "Santiago", "Benjamin", "Tomas", "Joaquin", "Agustin", "Nicolas", "Martin", "Sebastian", "Diego", "Ignacio", "Facundo", "Emiliano", "Valentin", "Bruno", "Alonso"],
  },
  english: {
    family: ["Miller", "Walker", "Carter", "Bennett", "Hughes", "Parker", "Turner", "Collins", "Murphy", "Brooks", "Foster", "Hayes", "Reed", "Ward", "Price", "Barnes", "Ellis", "Fisher", "Graham", "Hunt"],
    given: ["Ethan", "Mason", "Logan", "Tyler", "Jacob", "Ryan", "Austin", "Owen", "Caleb", "Nathan", "Dylan", "Connor", "Liam", "Jack", "Evan", "Isaac", "Wyatt", "Cole", "Noah", "Gavin"],
  },
  turkish: {
    family: ["Yilmaz", "Kaya", "Demir", "Sahin", "Celik", "Yildiz", "Aydin", "Ozturk", "Arslan", "Dogan", "Kilic", "Aslan", "Koc", "Kurt", "Polat", "Erdem"],
    given: ["Emre", "Burak", "Mert", "Kerem", "Arda", "Baris", "Cem", "Onur", "Yusuf", "Alp", "Efe", "Deniz", "Kaan", "Tolga", "Berk", "Ege"],
  },
  slavic: {
    family: ["Ivanov", "Smirnov", "Kuznetsov", "Popov", "Volkov", "Sokolov", "Morozov", "Petrov", "Orlov", "Lebedev", "Kozlov", "Novikov", "Bondarenko", "Kovalenko", "Melnyk", "Zaitsev"],
    given: ["Artem", "Dmitri", "Nikita", "Maksim", "Kirill", "Ilya", "Daniil", "Egor", "Timur", "Roman", "Pavel", "Denis", "Arsen", "Gleb", "Bogdan", "Stepan"],
  },
  central: {
    family: ["Nowak", "Kowalski", "Wisniewski", "Zielinski", "Novak", "Dvorak", "Svoboda", "Schmidt", "Weber", "Becker", "Wagner", "Horvath", "Popescu", "Krol", "Wojcik", "Fischer"],
    given: ["Jakub", "Kacper", "Szymon", "Filip", "Mateusz", "Tomas", "Lukas", "Jonas", "Felix", "Leon", "Adam", "Patrik", "Marek", "Andrei", "Bence", "Niklas"],
  },
  nordic: {
    family: ["Virtanen", "Korhonen", "Nieminen", "Lindqvist", "Johansson", "Berg", "Nielsen", "Hansen", "Kazlauskas", "Petrauskas", "Ozols", "Tamm", "Lund", "Holm", "Makela", "Dahl"],
    given: ["Elias", "Oskar", "Aleksi", "Eetu", "Viktor", "Emil", "Nils", "Matas", "Rokas", "Oliver", "Anton", "Joel", "Kasper", "Linus", "Henrik", "Ville"],
  },
  romance: {
    family: ["Martin", "Bernard", "Dubois", "Moreau", "Laurent", "Lefevre", "Rossi", "Russo", "Bianchi", "Janssens", "Peeters", "de Vries", "Bakker", "Girard", "Ricci", "Fontaine"],
    given: ["Hugo", "Louis", "Theo", "Nathan", "Enzo", "Mathis", "Jules", "Luca", "Matteo", "Lorenzo", "Sem", "Daan", "Bastien", "Romain", "Arno", "Tibo"],
  },
  arabic: {
    family: ["Haddad", "Mansour", "Nasser", "Saleh", "Khalil", "Benali", "Farouk", "Rahman", "Amrani", "Idrissi", "Hassan", "Sabri"],
    given: ["Youssef", "Omar", "Karim", "Adam", "Ziad", "Hamza", "Amine", "Ali", "Yassine", "Mahmoud", "Rayan", "Ilyas", "Nabil"],
  },
};

export interface PersonName { readonly given: string; readonly family: string; readonly full: string }

export function generatePersonName(rng: Rng, culture: Culture): PersonName {
  const pool = POOLS[culture];
  const given = pool.givenSyllables
    ? pick(rng, pool.givenSyllables[0]) + pick(rng, pool.givenSyllables[1])
    : pick(rng, pool.given);
  const family = pick(rng, pool.family);
  return { given, family, full: pool.familyFirst ? `${family} ${given}` : `${given} ${family}` };
}

// --- Handles -------------------------------------------------------------------------------------
// Invented syllables, combined as onset + (optional middle) + coda. Styles: Capitalised, lower,
// UPPER, or with a short digit tail — the shapes tags take, not any particular tag.
const ONSETS = ["v", "k", "z", "n", "r", "m", "s", "t", "qu", "br", "l", "w", "dr", "f", "j", "th", "y", "x", "c", "p", "gr", "sk", "h", "b"];
const VOWELS = ["a", "e", "i", "o", "u", "y", "ae", "ei", "ou", "io"];
const CODAS = ["x", "n", "r", "k", "s", "l", "th", "z", "m", "rn", "sk", "v", "", "", "", "nt", "ck", "ph"];

/** Fragments a handle may not contain (the syllable generator can assemble rude words). */
const BLOCKED = ["fuck", "fuk", "cuck", "shit", "cum", "nig", "fag", "rape", "sex", "dick", "cock", "porn", "nazi", "kkk", "slut", "whor", "bitch", "anal", "tit", "puss", "kys", "jew", "gay", "rap", "pis", "poo", "ass", "hore", "dik", "kok", "fap", "nud", "sx"];

/** True when a normalised handle contains a blocked fragment. */
export function isBlockedHandle(normalized: string): boolean {
  return BLOCKED.some((b) => normalized.includes(b));
}

export function normalizeHandle(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rawHandle(rng: Rng): string {
  const syllables = 1 + Math.floor(rng() * 2.4); // 1–3 syllables, mostly 1–2
  let s = "";
  for (let i = 0; i < syllables; i++) s += pick(rng, ONSETS) + pick(rng, VOWELS);
  s += pick(rng, CODAS);
  const style = rng();
  if (style < 0.5) return s[0]!.toUpperCase() + s.slice(1);
  if (style < 0.75) return s;
  if (style < 0.85) return s.toUpperCase();
  return s + String(Math.floor(rng() * 99) + 1);
}

/**
 * A handle that collides (after normalisation: case and punctuation ignored) with nothing in
 * `reserved`. Handles shorter than 3 characters, or containing a blocked fragment, are rejected too. The chosen handle is added to
 * `reserved`. Deterministic for a given rng state and reserved set.
 */
export function generateHandle(rng: Rng, reserved: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const h = rawHandle(rng);
    const n = normalizeHandle(h);
    if (n.length < 3 || n.length > 12 || reserved.has(n) || isBlockedHandle(n)) continue;
    reserved.add(n);
    return h;
  }
  // Practically unreachable (the syllable space is ~10^7); fall back to an indexed tag.
  let i = reserved.size;
  while (reserved.has(`rookie${i}`)) i++;
  reserved.add(`rookie${i}`);
  return `rookie${i}`;
}
