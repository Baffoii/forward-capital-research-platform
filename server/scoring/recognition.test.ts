import {
  themeMentionDensity,
  normalizeAnalystCount,
  normalizeThemeDensity,
  normalizeEtfCount,
  computeRecognition,
  type RecognitionInputs,
} from "./recognition.ts";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  pass  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const inputs = (o: Partial<RecognitionInputs> = {}): RecognitionInputs => ({
  analystCount: 10,
  themeMentionDensity: 3,
  thematicEtfCount: 2,
  multipleVsOwnHistory: 1.0,
  ...o,
});

console.log("\ntheme mention density");

const dense = themeMentionDensity(
  "Our data center business is growing. AI demand from hyperscalers is strong. " +
    "Data centre customers want more.",
);
check("counts theme terms per 1k words", dense > 100, `(got ${dense.toFixed(1)})`);
check(
  "a call that never mentions the theme scores zero",
  themeMentionDensity("We sell industrial pumps to municipal water utilities.") === 0,
);
check("empty text is zero, not NaN", themeMentionDensity("") === 0);

console.log("\ncomponent normalisation");

// No coverage is the condition the model hunts for, not a data defect.
check("zero analysts is zero recognition", normalizeAnalystCount(0) === 0);
check(
  "the 0-to-3 gap is larger than the 25-to-35 gap",
  normalizeAnalystCount(3) - normalizeAnalystCount(0) >
    normalizeAnalystCount(35) - normalizeAnalystCount(25),
);
check("heavy coverage saturates at 1", normalizeAnalystCount(60) === 1);
check("theme density saturates", normalizeThemeDensity(20) === 1);
check("no ETF membership is zero", normalizeEtfCount(0) === 0);

console.log("\ncomposite");

const obscure = computeRecognition(
  inputs({ analystCount: 1, themeMentionDensity: 0.2, thematicEtfCount: 0 }),
);
const crowded = computeRecognition(
  inputs({ analystCount: 30, themeMentionDensity: 9, thematicEtfCount: 8 }),
);
check("an uncovered name scores low", obscure.recognition < 0.2, `(got ${obscure.recognition})`);
check("a crowded name scores high", crowded.recognition > 0.9, `(got ${crowded.recognition})`);
check("the ordering is the whole point", crowded.recognition > obscure.recognition);

check(
  "analyst count carries more weight than ETF membership",
  computeRecognition(inputs({ analystCount: 30, themeMentionDensity: 0, thematicEtfCount: 0 }))
    .recognition >
    computeRecognition(inputs({ analystCount: 0, themeMentionDensity: 0, thematicEtfCount: 8 }))
      .recognition,
);

console.log("\nthe price term is excluded by default");

// multipleVsOwnHistory and estimateRevision both measure "the market has
// noticed". The scorer already uses estimate revision in the divergence term,
// so including this too prices obscurity twice.
const withRichMultiple = computeRecognition(inputs({ multipleVsOwnHistory: 2.5 }));
const withCheapMultiple = computeRecognition(inputs({ multipleVsOwnHistory: 0.6 }));
check(
  "the multiple does not move the default composite",
  withRichMultiple.recognition === withCheapMultiple.recognition,
  `(${withRichMultiple.recognition} vs ${withCheapMultiple.recognition})`,
);
check(
  "but it is computed and reported for the correlation check",
  withRichMultiple.recognitionWithPrice !== null &&
    withRichMultiple.recognitionWithPrice > withCheapMultiple.recognitionWithPrice!,
);

const enabled = computeRecognition(inputs({ multipleVsOwnHistory: 2.5 }), {
  includePriceTerm: true,
});
check(
  "enabling the price term changes the answer",
  enabled.recognition > withRichMultiple.recognition,
);
check(
  "and says why that needs checking",
  enabled.flags.includes("price_term_included_check_pearson_vs_estimate_revision"),
);
check(
  "asking for the price term when it is missing is flagged, not silent",
  computeRecognition(inputs({ multipleVsOwnHistory: null }), { includePriceTerm: true }).flags.includes(
    "price_term_requested_but_missing",
  ),
);

console.log("\nmissing inputs");

const nothing = computeRecognition({
  analystCount: null,
  themeMentionDensity: null,
  thematicEtfCount: null,
  multipleVsOwnHistory: null,
});
// 0 would assert obscurity and hand every uncovered company a maximum long
// multiplier on no evidence whatsoever.
check("no inputs gives 0.5, not 0", nothing.recognition === 0.5);
check("and is flagged as such", nothing.flags.includes("no_recognition_inputs"));
check("with near-zero confidence", nothing.confidence <= 0.1);

const partial = computeRecognition(
  inputs({ themeMentionDensity: null, thematicEtfCount: null }),
);
check("a single input still produces a reading", partial.recognition > 0);
check("partial coverage is flagged", partial.flags.includes("partial_recognition_coverage"));
check(
  "confidence tracks coverage",
  partial.confidence < computeRecognition(inputs()).confidence,
);
check("coverage is reported", Math.abs(partial.coverage - 1 / 3) < 1e-9);

check(
  "recognition is always within 0..1",
  [
    computeRecognition(inputs({ analystCount: 500, themeMentionDensity: 99, thematicEtfCount: 99 })),
    computeRecognition(inputs({ analystCount: 0, themeMentionDensity: 0, thematicEtfCount: 0 })),
  ].every((r) => r.recognition >= 0 && r.recognition <= 1),
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
