import { strict as assert } from "node:assert";
import { TEAM_EMAILS, isTeamMember, normalizeEmail, shortName } from "./team.ts";

let failed = 0;
let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  pass  ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function group(name: string) {
  console.log(`\n${name}`);
}

group("allowlist");

test("the three team addresses are allowed", () => {
  for (const email of TEAM_EMAILS) {
    assert.equal(isTeamMember(email), true, `${email} should be allowed`);
  }
});

test("anyone else is rejected", () => {
  assert.equal(isTeamMember("stranger@stanford.edu"), false);
  assert.equal(isTeamMember("magniac@gmail.com"), false);
  assert.equal(isTeamMember(""), false);
  assert.equal(isTeamMember(null), false);
  assert.equal(isTeamMember(undefined), false);
});

test("case and whitespace do not let someone in or keep someone out", () => {
  assert.equal(isTeamMember("  MaasG@Stanford.EDU  "), true);
  assert.equal(isTeamMember("MAGNIAC@STANFORD.EDU"), true);
});

test("a near-miss address does not get in", () => {
  // The failure this catches: a substring check would let these through.
  assert.equal(isTeamMember("xmaasg@stanford.edu"), false);
  assert.equal(isTeamMember("maasg@stanford.edu.evil.com"), false);
  assert.equal(isTeamMember("maasg@stanford.edu "), true); // trailing space is fine
});

group("display helpers");

test("normalizeEmail is stable", () => {
  assert.equal(normalizeEmail(" A@B.COM "), "a@b.com");
  assert.equal(normalizeEmail(null), "");
});

test("shortName drops the domain", () => {
  assert.equal(shortName("rchen23@stanford.edu"), "rchen23");
  assert.equal(shortName(null), "someone");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
