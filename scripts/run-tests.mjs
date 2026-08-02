/**
 * Test runner. Walks the tree for *.test.ts and runs each on bare node with
 * type stripping — no test framework, no transpile step, no config.
 *
 * A test file signals failure with a non-zero exit code.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["server", "shared", "client/src"];
const SKIP = new Set(["node_modules", "dist", ".git", "__pycache__"]);

function findTests(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(findTests(full));
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap(findTests).sort();

if (files.length === 0) {
  console.error("no *.test.ts files found");
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  console.log(`\n─── ${file} ${"─".repeat(Math.max(0, 60 - file.length))}`);
  const res = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", file],
    { stdio: "inherit" },
  );
  if (res.status !== 0) failures++;
}

console.log(
  `\n${files.length - failures}/${files.length} test files passed\n`,
);
process.exit(failures > 0 ? 1 : 0);
