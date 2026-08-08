import { latestMaterialMove, MATERIAL_MOVE_PCT, type DailyClose } from "./source.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  pass  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const series = (...closes: number[]): DailyClose[] =>
  closes.map((close, i) => ({ date: `2026-08-0${i + 1}`, close }));

console.log("\nmaterial price moves");

check(
  "a big drop is a move",
  latestMaterialMove("VRT", series(100, 88))?.changePct === -12,
);

check(
  "a big rise is a move too",
  // Being right for the wrong reason matters as much as being wrong.
  (latestMaterialMove("VRT", series(100, 115))?.changePct ?? 0) > 0,
);

check("a small wobble is not", latestMaterialMove("VRT", series(100, 103)) === null);

check(
  "the threshold boundary counts",
  latestMaterialMove("VRT", series(100, 100 - MATERIAL_MOVE_PCT)) !== null,
);

check(
  "it reads the LAST two closes, not the first",
  // The series comes back oldest-first; comparing the wrong end would report
  // a move from months ago as today's news.
  latestMaterialMove("VRT", series(100, 50, 200, 202)) === null,
);

check("a single close cannot be a move", latestMaterialMove("VRT", series(100)) === null);
check("an empty series is not a crash", latestMaterialMove("VRT", []) === null);

check(
  "a zero previous close does not divide by zero",
  latestMaterialMove("VRT", series(0, 50)) === null,
);

check(
  "it carries both endpoints so the notification can quote them",
  (() => {
    const m = latestMaterialMove("VRT", series(100, 88));
    return m?.from.close === 100 && m?.to.close === 88 && m.to.date === "2026-08-02";
  })(),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
