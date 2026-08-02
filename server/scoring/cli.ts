/**
 * Pipeline entry points.
 *
 *   npm run score            -- score as of now
 *   npm run score 2026-03-31 -- score as of a past date, point-in-time
 *   npm run pipeline         -- ingest everything, then score
 *
 * Every stage takes an explicit asOf and every read inside them goes through
 * asKnownAt(), so scoring a past date uses only what was knowable then.
 */

import "dotenv/config";
import { runScoring } from "./runner.ts";
import { deriveConstraintStates, ingestBacklogForCompany } from "../ingestion/edgar-backlog";
import { ingestExposureForCompany } from "../ingestion/edgar-exposure";
import { ingestTranscripts } from "../transcripts/ingest.ts";
import { collectRecognition } from "./recognition-collect.ts";
import { storage } from "../storage";

function parseAsOf(argv: string[]): Date {
  const arg = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (!arg) return new Date();
  const d = new Date(`${arg}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable date: ${arg}`);
  return d;
}

export async function scoreCommand(asOf: Date): Promise<void> {
  const result = await runScoring(asOf);
  console.log(`\nscoring as of ${asOf.toISOString()} (scorer ${result.scorerVersion})`);
  console.log(`  pairs considered      ${result.pairsConsidered}`);
  console.log(`  scores written        ${result.scoresWritten}`);
  console.log(`  already scored        ${result.skippedAlreadyScored}`);
  console.log(`  skipped, missing inputs ${result.skippedMissingInputs.length}`);
  // An empty board with reasons is informative. An empty board with no
  // explanation looks like a bug and gets debugged instead of fixed.
  for (const s of result.skippedMissingInputs.slice(0, 20)) {
    console.log(`    company ${s.companyId} / ${s.constraintSlug}: ${s.reason}`);
  }
  if (result.skippedMissingInputs.length > 20) {
    console.log(`    ... and ${result.skippedMissingInputs.length - 20} more`);
  }
}

export async function pipelineCommand(asOf: Date): Promise<void> {
  const companies = (await storage.listCompanies()).filter((c) => c.ticker);
  console.log(`\ningesting for ${companies.length} companies with tickers\n`);

  for (const c of companies) {
    try {
      const exposure = await ingestExposureForCompany(c.id, c.ticker!, 0);
      console.log(`  ${c.ticker}: ${exposure.edgesWritten} exposure edge(s)`);
      for (const n of exposure.notes) console.log(`      ${n}`);
    } catch (err: any) {
      // Partial coverage with an honest note beats a stalled pipeline.
      console.log(`  ${c.ticker}: exposure ingestion failed — ${err.message}`);
    }
    try {
      const backlog = await ingestBacklogForCompany(c.id, c.ticker!);
      console.log(`  ${c.ticker}: ${backlog.metricsWritten} capture metric(s)`);
      for (const n of backlog.notes.slice(0, 3)) console.log(`      ${n}`);
    } catch (err: any) {
      console.log(`  ${c.ticker}: backlog ingestion failed — ${err.message}`);
    }
  }

  const transcripts = await ingestTranscripts(asOf);
  console.log(
    `\ntranscripts: ${transcripts.transcriptsRead} read, ` +
      `${transcripts.readingsProduced} reading(s), ${transcripts.statesWritten} state(s)`,
  );
  for (const s of transcripts.sourcesSkipped) console.log(`  skipped ${s.id}: ${s.reason}`);
  for (const n of transcripts.notes) console.log(`  ${n}`);

  const states = await deriveConstraintStates(asOf);
  console.log(`\nbacklog-derived constraint states: ${states.statesWritten} written`);
  for (const s of states.skipped.slice(0, 20)) {
    console.log(`  skipped ${s.constraintSlug}: ${s.reason}`);
  }

  const recognition = await collectRecognition(asOf);
  console.log(`\nrecognition snapshots: ${recognition.snapshotsWritten} written`);
  for (const n of recognition.notes) console.log(`  ${n}`);

  await scoreCommand(asOf);
}

const invoked = process.argv[1]?.endsWith("cli.ts") ?? false;
if (invoked) {
  const asOf = parseAsOf(process.argv.slice(2));
  const command = process.argv.includes("pipeline") ? pipelineCommand : scoreCommand;
  command(asOf)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\nfailed: ${err.message}`);
      process.exit(1);
    });
}
