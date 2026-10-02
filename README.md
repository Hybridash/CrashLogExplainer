# Crash Log Explainer

**Minecraft crashed? Paste the crash log and get a plain-English answer**: what broke, which mod did it, and how to fix it.

**Use it here: https://hybridash.github.io/CrashLogExplainer/**

Your log never leaves your computer. Everything runs in the page, with no server.

## What it can spot

| Problem | Example of what it tells you |
|---|---|
| Missing dependency (Fabric, Forge, NeoForge) | *Sodium Extra needs Fabric API, and it isn't installed*, with a Modrinth link |
| Wrong version of a dependency | *Iris wants Sodium 0.6.0 or later, but you have 0.5.3* |
| Mod for the wrong Minecraft version | *Old Thing needs Minecraft 1.20.1, but this is 1.21.1* |
| Wrong Java version | *You need Java 21, you're using Java 17*, plus how to change it in Prism |
| Out of memory | How much RAM to give Minecraft for your PC |
| Graphics driver crashes | NVIDIA / AMD / Intel driver crashes, OpenGL errors, laptop dual-GPU fix |
| Mixin failures | Which mod failed to patch Minecraft |
| Missing library classes | Maps class names to the mod you need (Cloth Config, Architectury, GeckoLib, and about 40 more) |
| Forge mods in a Fabric game | Spots `net.minecraftforge` classes |
| Duplicate mods | Two copies of the same mod |
| Ticking entity crashes | Which mob or block in your world crashed, and where |
| Which mod was running | Reads mixin handler names and the stack trace to name the most likely mod |
| Launcher exit codes | `-1073741819`, `-805306369`, `137`, and others in plain English |
| OptiFine with Fabric | Suggests Sodium + Iris instead |

## Running it locally

It's a static page, so any web server works:

```
python3 -m http.server
```

Then open http://localhost:8000.

## Tests

```
node test/run.js
```

This runs every log in `samples/` through the analyzer and checks that it finds the right problem. To add a new crash type: drop the log in `samples/`, add a rule in `src/analyzer.js`, and add what you expect to `test/run.js`.

## Hosting

GitHub Actions runs the tests and deploys to GitHub Pages on every push to `main` (see `.github/workflows/pages.yml`).
