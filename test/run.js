// node test/run.js  -> runs every sample through the analyzer and checks the top finding
const fs = require("fs");
const path = require("path");
const { analyze } = require("../src/analyzer.js");

const expect = {
  "missing-fabric-api.log": [/Sodium Extra needs fabric-api/, /Iris needs a different version of Sodium/, /Old Thing is made for a different Minecraft/],
  "java-version.log": [/you need Java 21, you're using Java 17/],
  "ticking-entity.txt": [/Something in your world crashed/, /coolmobs/],
  "out-of-memory.log": [/ran out of memory/],
  "driver.log": [/Graphics driver/, /Exit code -1073741819/],
  "mixin.log": [/fancymenu failed to patch/],
  "missing-lib.log": [/Missing library: Cloth Config/],
  "forge-missing.log": [/alexsmobs needs geckolib/],
};

let failed = 0;
for (const [file, checks] of Object.entries(expect)) {
  const text = fs.readFileSync(path.join(__dirname, "..", "samples", file), "utf8");
  const { info, findings } = analyze(text);
  const titles = findings.map((f) => `[${f.severity}] ${f.title}`);
  for (const re of checks) {
    if (!titles.some((t) => re.test(t))) {
      failed++;
      console.log(`FAIL ${file}: nothing matched ${re}\n  got: ${titles.join("\n       ")}`);
    }
  }
  console.log(`${file}: MC ${info.minecraft} ${info.loader} ${info.loaderVersion || ""} Java ${info.java} -> ${titles.length} findings`);
  titles.forEach((t) => console.log("   " + t));
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
