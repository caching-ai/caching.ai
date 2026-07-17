import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const bin = join(dirname(fileURLToPath(import.meta.url)), "../bin/cache-guard.mjs");

function run(args, cwd) {
  return execFileSync("node", [bin, ...args], { cwd, encoding: "utf8" });
}

test("snapshot then check passes; prefix change fails with exit 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-"));
  const fixture = join(dir, "req.json");
  writeFileSync(fixture, JSON.stringify({ system: "stable prompt", messages: [{ role: "user", content: "q" }] }));

  assert.match(run(["snapshot", "req.json"], dir), /baseline written/);
  assert.match(run(["check", "req.json"], dir), /OK/);

  writeFileSync(fixture, JSON.stringify({ system: "stable prompt v2", messages: [{ role: "user", content: "q" }] }));
  let code = 0;
  try {
    run(["check", "req.json"], dir);
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 1);
});
