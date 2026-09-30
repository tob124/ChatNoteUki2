import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const paths = execFileSync("git", ["ls-files", "--cached"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
const forbidden = [
  /sk-[A-Za-z0-9]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
];
let failed = false;
for (const path of paths) {
  if (
    /\.(db|pem|key)$/.test(path) ||
    /(^|\/)(credentials\.json|\.env|inbox\.txt)$/.test(path)
  ) {
    process.stderr.write(`Forbidden tracked file: ${path}\n`);
    failed = true;
  }
  const data = readFileSync(path, "utf8");
  if (forbidden.some((pattern) => pattern.test(data))) {
    process.stderr.write(`Possible credential in: ${path}\n`);
    failed = true;
  }
}
if (failed) process.exit(1);
process.stdout.write(
  `Checked ${paths.length} tracked files: no credentials or private data detected.\n`,
);
