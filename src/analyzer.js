/*
 * Crash Log Explainer: the brain.
 * Takes the text of a Minecraft crash report or latest.log and returns
 *   { info: {...}, findings: [{ severity, title, explain, fixes[], evidence }] }
 * Works in the browser (window.CrashAnalyzer) and in Node (module.exports) so it can be tested.
 */
(function (root) {
  "use strict";

  // Java "class file version" -> the Java version that made it
  const CLASS_VERSION_TO_JAVA = { 52: 8, 55: 11, 60: 16, 61: 17, 65: 21, 66: 22, 67: 23, 68: 24, 69: 25 };

  // Package name prefixes -> the mod (or library) people actually need to install.
  // Used when a crash says a class is missing, and to guess which mod a stack trace points at.
  const KNOWN_PACKAGES = [
    ["net.fabricmc.fabric.", "Fabric API", "fabric-api"],
    ["me.shedaniel.clothconfig", "Cloth Config", "cloth-config"],
    ["me.shedaniel.autoconfig", "Cloth Config", "cloth-config"],
    ["me.shedaniel.architectury", "Architectury API", "architectury-api"],
    ["dev.architectury.", "Architectury API", "architectury-api"],
    ["com.terraformersmc.modmenu", "Mod Menu", "modmenu"],
    ["dev.isxander.yacl", "YetAnotherConfigLib (YACL)", "yacl"],
    ["software.bernie.geckolib", "GeckoLib", "geckolib"],
    ["mod.azure.azurelib", "AzureLib", "azurelib"],
    ["io.wispforest.owo", "oωo-lib (owo-lib)", "owo-lib"],
    ["eu.midnightdust.lib", "MidnightLib", "midnightlib"],
    ["dev.lambdaurora.lambdynlights", "LambDynamicLights", "lambdynamiclights"],
    ["me.jellysquid.mods.sodium", "Sodium", "sodium"],
    ["net.caffeinemc.mods.sodium", "Sodium", "sodium"],
    ["me.jellysquid.mods.lithium", "Lithium", "lithium"],
    ["net.caffeinemc.mods.lithium", "Lithium", "lithium"],
    ["net.irisshaders.", "Iris", "iris"],
    ["net.coderbot.iris", "Iris", "iris"],
    ["com.ishland.c2me", "C2ME", "c2me-fabric"],
    ["org.embeddedt.modernfix", "ModernFix", "modernfix"],
    ["dev.tr7zw.entityculling", "Entity Culling", "entityculling"],
    ["net.raphimc.immediatelyfast", "ImmediatelyFast", "immediatelyfast"],
    ["fi.dy.masa.malilib", "MaLiLib", "malilib"],
    ["fi.dy.masa.litematica", "Litematica", "litematica"],
    ["fi.dy.masa.minihud", "MiniHUD", "minihud"],
    ["mezz.jei", "JEI", "jei"],
    ["me.shedaniel.rei", "Roughly Enough Items", "rei"],
    ["dev.emi.emi", "EMI", "emi"],
    ["xaero.", "Xaero's Map", "xaeros-minimap"],
    ["journeymap.", "JourneyMap", "journeymap"],
    ["com.github.alexthe666.citadel", "Citadel", "citadel"],
    ["com.teamresourceful.resourcefullib", "Resourceful Lib", "resourceful-lib"],
    ["com.teamresourceful.resourcefulconfig", "Resourceful Config", "resourceful-config"],
    ["dev.onyxstudios.cca", "Cardinal Components API", "cardinal-components-api"],
    ["org.ladysnake.cca", "Cardinal Components API", "cardinal-components-api"],
    ["eu.pb4.placeholders", "Text Placeholder API", "placeholder-api"],
    ["com.llamalad7.mixinextras", "MixinExtras", "mixinextras"],
    ["net.minecraftforge.", "Forge (this is a Forge mod)", null],
    ["net.neoforged.", "NeoForge (this is a NeoForge mod)", null],
    ["com.simibubi.create", "Create", "create"],
    ["vazkii.patchouli", "Patchouli", "patchouli"],
    ["top.theillusivec4.curios", "Curios API", "curios"],
    ["dev.emi.trinkets", "Trinkets", "trinkets"],
    ["team.reborn.energy", "Team Reborn Energy", "team-reborn-energy"],
    ["com.jamieswhiteshirt.reachentityattributes", "Reach Entity Attributes", "reach-entity-attributes"],
    ["blue.endless.jankson", "Jankson (usually bundled; update the mod that needs it)", null],
    ["fuzs.puzzleslib", "Puzzles Lib", "puzzles-lib"],
    ["net.blay09.mods.balm", "Balm", "balm"],
    ["com.faux.ingredientextension", "Ingredient Extension API", null],
    ["dev.kosmx.playerAnim", "playerAnimator", "playeranimator"],
    ["com.github.L_Ender.lionfishapi", "LionfishAPI", null],
  ];

  // Frames from these packages are Minecraft / Java / the loader itself, not a mod.
  const VANILLA_PREFIXES = [
    "java.", "javax.", "jdk.", "sun.", "com.sun.", "net.minecraft.", "com.mojang.", "org.lwjgl.",
    "net.fabricmc.loader.", "net.fabricmc.api.", "org.spongepowered.", "com.google.", "io.netty.",
    "org.apache.", "it.unimi.", "org.slf4j.", "cpw.mods.", "net.minecraftforge.fml.", "net.neoforged.fml.",
    "net.neoforged.neoforge.", "net.minecraftforge.eventbus.", "org.quiltmc.loader.", "org.prismlauncher.",
    "org.multimc.", "oshi.", "org.joml.", "kotlin.", "kotlinx.", "com.llamalad7.mixinextras.",
    "net.fabricmc.fabric.impl.base.", "manifold.", "org.objectweb.", "com.electronwill.",
  ];

  function lookupPackage(name) {
    for (const [prefix, mod, slug] of KNOWN_PACKAGES) {
      if (name.startsWith(prefix)) return { mod, slug };
    }
    return null;
  }

  function modrinthLink(slug) {
    return slug ? `https://modrinth.com/mod/${slug}` : null;
  }

  function firstMatch(text, re) {
    const m = text.match(re);
    return m ? m : null;
  }

  function lineOf(text, index) {
    const start = text.lastIndexOf("\n", index) + 1;
    let end = text.indexOf("\n", index);
    if (end === -1) end = text.length;
    return text.slice(start, end).trim();
  }

  // ---------------------------------------------------------------------------------------
  // Basic info: Minecraft version, loader, Java, mod count
  // ---------------------------------------------------------------------------------------
  function readInfo(text) {
    const info = { minecraft: null, loader: null, loaderVersion: null, java: null, mods: null, kind: null };

    if (/----\s*Minecraft Crash Report\s*----/.test(text)) info.kind = "Crash report";
    else if (/#\s*A fatal error has been detected by the Java Runtime Environment/.test(text)) info.kind = "Java (JVM) crash";
    else if (/\[main\/(INFO|WARN|ERROR)\]|\[\d\d:\d\d:\d\d\]/.test(text)) info.kind = "Game log";
    else info.kind = "Log";

    let m =
      firstMatch(text, /Minecraft Version:\s*([0-9][\w.\-]*)/) ||
      firstMatch(text, /Loading Minecraft ([0-9][\w.\-]*) with Fabric Loader/) ||
      firstMatch(text, /Loading Minecraft ([0-9][\w.\-]*) with Quilt Loader/) ||
      firstMatch(text, /--version,?\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/) ||
      firstMatch(text, /Minecraft (1\.\d+(?:\.\d+)?)/);
    if (m) info.minecraft = m[1];

    if ((m = firstMatch(text, /with Fabric Loader ([0-9][\w.\-+]*)/)) || (m = firstMatch(text, /fabricloader[^\n]*?(\d+\.\d+\.\d+)/))) {
      info.loader = "Fabric"; info.loaderVersion = m[1];
    } else if ((m = firstMatch(text, /with Quilt Loader ([0-9][\w.\-+]*)/))) {
      info.loader = "Quilt"; info.loaderVersion = m[1];
    } else if ((m = firstMatch(text, /NeoForge(?: version)?:?\s*([0-9][\w.\-]*)/i)) || /net\.neoforged/.test(text)) {
      info.loader = "NeoForge"; info.loaderVersion = m ? m[1] : null;
    } else if ((m = firstMatch(text, /Forge(?: Mod Loader)? version:?\s*([0-9][\w.\-]*)/i)) || /net\.minecraftforge|cpw\.mods/.test(text)) {
      info.loader = "Forge"; info.loaderVersion = m ? m[1] : null;
    } else if (/net\.fabricmc|Fabric Mods:/.test(text)) {
      info.loader = "Fabric";
    }

    if ((m = firstMatch(text, /Java Version:\s*([0-9][\w.\-+]*)/)) ||
        (m = firstMatch(text, /Java is version ([0-9][\w.\-+]*)/)) ||
        (m = firstMatch(text, /JRE version: [^(]*\(([0-9][\w.\-+]*)/)) ||
        (m = firstMatch(text, /Java ([0-9]{1,2}(?:\.[0-9.]+)?)[^\n]*\b(?:64|32)bit/))) {
      info.java = m[1];
    }

    if ((m = firstMatch(text, /Loading (\d+) mods:/))) info.mods = parseInt(m[1], 10);
    else if ((m = firstMatch(text, /Fabric Mods:\s*\n([\s\S]*?)\n\s*\n/))) {
      info.mods = m[1].split("\n").filter((l) => /^\s+\S+:/.test(l)).length || null;
    }
    return info;
  }

  // ---------------------------------------------------------------------------------------
  // Rules. Each returns zero or more findings.
  // severity: "fix" = almost certainly the cause, "likely" = probably related, "info" = worth knowing
  // ---------------------------------------------------------------------------------------
  const rules = [];

  // Fabric: missing or wrong-version dependencies.
  // Loader 0.15+ prints lines like:
  //   - Mod 'Iris' (iris) 1.7.2 requires any version of sodium, which is missing!
  //   - Mod 'Iris' (iris) 1.7.2 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!
  //   - Mod 'X' (x) 1.0 is incompatible with any version of mod 'Y' (y), but ...
  rules.push(function fabricDependencies(text) {
    const out = [];
    const DEP = "(?:mod '([^']+)' \\(([\\w\\-.]+)\\)|([\\w\\-.]+))";
    const HEAD = "Mod '([^']+)' \\(([\\w\\-.]+)\\) (\\S+) ";
    const seen = new Set();
    let m;

    const missing = new RegExp(HEAD + "requires (.+?) of " + DEP + ", which is missing", "g");
    while ((m = missing.exec(text))) {
      const [, modName, , , want, depName1, depId1, depId2] = m;
      const depId = depId1 || depId2, depName = depName1 || depId2;
      if (seen.has(modName + depId)) continue;
      seen.add(modName + depId);
      const ver = /any version/.test(want) ? "" : ` (${want.replace(/^version /, "version ")})`;
      out.push({
        severity: "fix",
        title: `${modName} needs ${depName}, and it isn't installed`,
        explain: `${modName} can't load without ${depName}${ver}.`,
        fixes: [`Download ${depName} for your Minecraft version and put it in the mods folder.`],
        link: depId === "minecraft" || depId === "java" ? null : modrinthLink(depId),
        evidence: lineOf(text, m.index),
      });
    }

    const wrong = new RegExp(HEAD + "requires (.+?) of " + DEP + ", but only the wrong version is present: ([^!\\n]+)", "g");
    while ((m = wrong.exec(text))) {
      const [, modName, modId, , want, depName1, depId1, depId2, have] = m;
      const depId = depId1 || depId2, depName = depName1 || depId2;
      if (seen.has(modName + depId)) continue;
      seen.add(modName + depId);
      if (depId === "minecraft") {
        out.push({
          severity: "fix",
          title: `${modName} is made for a different Minecraft version`,
          explain: `${modName} needs Minecraft ${want.replace(/^version /, "")}, but this is Minecraft ${have.trim()}.`,
          fixes: [`Download the version of ${modName} made for Minecraft ${have.trim()}, or remove it.`],
          link: modrinthLink(modId),
          evidence: lineOf(text, m.index),
        });
      } else if (depId === "java") {
        out.push({
          severity: "fix",
          title: `${modName} needs a newer Java`,
          explain: `${modName} needs Java ${want.replace(/^version /, "")}, but you're running Java ${have.trim()}.`,
          fixes: ["Change the instance's Java version in your launcher settings."],
          evidence: lineOf(text, m.index),
        });
      } else {
        out.push({
          severity: "fix",
          title: `${modName} needs a different version of ${depName}`,
          explain: `${modName} wants ${depName} ${want.replace(/^version /, "")}, but you have ${have.trim()}.`,
          fixes: [`Update ${depName} and ${modName} to their newest versions for your Minecraft version.`],
          link: modrinthLink(depId),
          evidence: lineOf(text, m.index),
        });
      }
    }

    const incompatible = new RegExp(HEAD + "is incompatible with .*? of " + DEP, "g");
    while ((m = incompatible.exec(text))) {
      const other = m[5] || m[7];
      out.push({
        severity: "fix",
        title: `${m[1]} and ${other} don't work together`,
        explain: `${m[1]} says it is incompatible with ${other}.`,
        fixes: ["Remove one of them, or check if a newer version of either mod fixes it."],
        evidence: lineOf(text, m.index),
      });
    }
    return out;
  });

  // Forge / NeoForge: missing dependencies
  rules.push(function forgeDependencies(text) {
    const out = [];
    const re = /Mod ID: '([\w\-.]+)', Requested by: '([\w\-.]+)', Expected range: '([^']*)', Actual version: '([^']*)'/g;
    let m;
    while ((m = re.exec(text))) {
      const missing = /MISSING/i.test(m[4]);
      out.push({
        severity: "fix",
        title: missing ? `${m[2]} needs ${m[1]}, and it isn't installed` : `${m[2]} needs a different version of ${m[1]}`,
        explain: missing
          ? `${m[2]} can't load without ${m[1]} (version ${m[3]}).`
          : `${m[2]} wants ${m[1]} ${m[3]}, but you have ${m[4]}.`,
        fixes: [missing ? `Download ${m[1]} for your Minecraft version and put it in the mods folder.` : `Update ${m[1]} so it matches.`],
        link: modrinthLink(m[1]),
        evidence: lineOf(text, m.index),
      });
    }
    return out;
  });

  // Duplicate mods
  rules.push(function duplicates(text) {
    const m = firstMatch(text, /(Found duplicate mods?|Duplicate mods? found|Mods share ID|multiple (?:copies|versions) of (?:the )?mod|is (?:a )?duplicate)/i);
    if (!m) return [];
    return [{
      severity: "fix",
      title: "You have the same mod installed twice",
      explain: "Two copies of the same mod are in your mods folder, usually an old version and a new one.",
      fixes: ["Open the mods folder and delete the older copy.", "Watch out for files with (1) in the name: those are duplicate downloads."],
      evidence: lineOf(text, m.index),
    }];
  });

  // Mixin failures: which mod's code failed to apply
  rules.push(function mixins(text) {
    const out = [];
    const re = /Mixin \[([\w\-.]+?)\.mixins?\.json:([\w.$]+)(?: from mod ([\w\-.]+))?\][^\n]*?(?:failed|FAILED|error|threw)/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(text))) {
      const mod = m[3] || m[1];
      if (seen.has(mod)) continue;
      seen.add(mod);
      out.push({
        severity: "likely",
        title: `${mod} failed to patch Minecraft`,
        explain: `${mod} changes Minecraft's code with a "mixin", and that failed. This usually means the mod is for a different Minecraft version, or another mod changes the same code.`,
        fixes: [`Update ${mod} to the newest version for your Minecraft version.`, `If that doesn't help, remove ${mod} and see if the game starts.`],
        evidence: lineOf(text, m.index),
      });
    }
    const re3 = /Mixin apply (?:for mod|failed for mod) ([\w\-.]+) failed/g;
    while ((m = re3.exec(text))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({
        severity: "likely",
        title: `${m[1]} failed to patch Minecraft`,
        explain: `${m[1]} changes Minecraft's code with a "mixin", and that failed. This usually means the mod is for a different Minecraft version, or another mod changes the same code.`,
        fixes: [`Update ${m[1]} to the newest version for your Minecraft version.`, `If that doesn't help, remove ${m[1]} and see if the game starts.`],
        evidence: lineOf(text, m.index),
      });
    }
    const re2 = /(?:InvalidInjectionException|InvalidMixinException|MixinApplyError|MixinTransformerError)[^\n]*?([\w\-]+)\.mixins?\.json/g;
    while ((m = re2.exec(text))) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({
        severity: "likely",
        title: `${m[1]} failed to patch Minecraft`,
        explain: `The mod behind "${m[1]}.mixins.json" couldn't apply its changes to Minecraft.`,
        fixes: [`Update that mod, or remove it to confirm it's the problem.`],
        evidence: lineOf(text, m.index),
      });
    }
    return out;
  });

  // Missing classes -> missing library mod
  rules.push(function missingClass(text) {
    const out = [];
    const re = /(?:NoClassDefFoundError|ClassNotFoundException):?\s+([\w.$\/]+)/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(text))) {
      const cls = m[1].replace(/\//g, ".");
      const hit = lookupPackage(cls);
      const key = hit ? hit.mod : cls;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hit && /Forge|NeoForge/.test(hit.mod)) {
        out.push({
          severity: "fix",
          title: "A Forge/NeoForge mod is in a Fabric game",
          explain: `Something tried to use ${cls}, which only exists in ${hit.mod.split(" ")[0]}. Forge and Fabric mods can't be mixed.`,
          fixes: ["Find the mod that isn't for your loader and swap it for the Fabric version (or remove it)."],
          evidence: lineOf(text, m.index),
        });
      } else if (hit) {
        out.push({
          severity: "fix",
          title: `Missing library: ${hit.mod}`,
          explain: `A mod needs ${hit.mod}, but it isn't installed (or it's the wrong version).`,
          fixes: [`Install ${hit.mod} for your Minecraft version.`, `If it's already installed, update it.`],
          link: modrinthLink(hit.slug),
          evidence: lineOf(text, m.index),
        });
      } else if (!cls.startsWith("net.minecraft") && !cls.startsWith("java")) {
        out.push({
          severity: "likely",
          title: `Something is missing: ${cls}`,
          explain: "A mod tried to use code from another mod or library that isn't there. Usually a missing dependency, or a mod built for a different Minecraft version.",
          fixes: [`Search the first part of the name (${cls.split(".").slice(0, 3).join(".")}) to find which mod it belongs to, then install or update it.`],
          evidence: lineOf(text, m.index),
        });
      }
    }
    return out;
  });

  // Wrong Java version
  rules.push(function javaVersion(text) {
    const out = [];
    let m = firstMatch(text, /compiled by a more recent version of the Java Runtime \(class file version (\d+)\.\d+\), this version of the Java Runtime only recognizes class file versions up to (\d+)/);
    if (m) {
      const need = CLASS_VERSION_TO_JAVA[+m[1]] || `newer`;
      const have = CLASS_VERSION_TO_JAVA[+m[2]] || "older";
      out.push({
        severity: "fix",
        title: `Wrong Java version: you need Java ${need}, you're using Java ${have}`,
        explain: "Something in this game was built for a newer Java than the one your launcher is using.",
        fixes: [
          `In Prism Launcher: Edit instance → Settings → Java → Auto-detect, and pick Java ${need}.`,
          `Don't have it? Download Java ${need} from adoptium.net, or let Prism download it automatically.`,
          "Minecraft 1.20.5 and newer need Java 21. Minecraft 1.18–1.20.4 need Java 17.",
        ],
        evidence: lineOf(text, m.index),
      });
    }
    m = firstMatch(text, /(?:requires|needs) Java (\d+)|Java (\d+) or (?:above|newer|later) is required/i);
    if (m && !out.length) {
      out.push({
        severity: "fix",
        title: `This needs Java ${m[1] || m[2]}`,
        explain: "Your launcher is running Minecraft with an older Java than this setup needs.",
        fixes: [`Set the instance's Java to version ${m[1] || m[2]} in your launcher's settings.`],
        evidence: lineOf(text, m.index),
      });
    }
    return out;
  });

  // Out of memory
  rules.push(function memory(text) {
    const m = firstMatch(text, /java\.lang\.OutOfMemoryError: ?([^\n]*)/);
    if (!m) return [];
    return [{
      severity: "fix",
      title: "Minecraft ran out of memory (RAM)",
      explain: "The game used all the RAM it was given and crashed.",
      fixes: [
        "Give Minecraft more RAM in your launcher (Prism: Edit instance → Settings → Java → Maximum memory).",
        "Good amounts: 4 GB PC → 2048 MB, 8 GB PC → 3072–4096 MB, 16 GB+ PC → 4096–6144 MB.",
        "Don't give it more than about half your PC's RAM.",
        "Lower your render distance, and remove big texture or resource packs.",
      ],
      evidence: lineOf(text, m.index),
    }];
  });

  // Graphics driver problems
  rules.push(function graphics(text) {
    const out = [];
    const m = firstMatch(text,
      /(Pixel format not accelerated|GLFW error 65542|WGL: The driver does not appear to support OpenGL|GLFW error 65543|Couldn't set pixel format|OpenGL 3\.2 is not supported|Could not create context|No OpenGL context found|GL_OUT_OF_MEMORY|GLX: Failed to create context|atio6axx\.dll|nvoglv64\.dll|ig\d+icd64\.dll|ig\w+icd64\.dll)/i);
    if (m) {
      const isNvidia = /nvoglv64/i.test(m[1]);
      const isAmd = /atio6axx/i.test(m[1]);
      const isIntel = /icd64/i.test(m[1]);
      out.push({
        severity: "fix",
        title: "Graphics driver problem",
        explain: isNvidia ? "The crash happened inside the NVIDIA graphics driver."
          : isAmd ? "The crash happened inside the AMD graphics driver."
          : isIntel ? "The crash happened inside the Intel graphics driver."
          : "Minecraft couldn't start OpenGL, which means your graphics driver is missing, too old, or Minecraft is using the wrong GPU.",
        fixes: [
          "Update your graphics driver from the official site (nvidia.com, amd.com, or intel.com), not Windows Update.",
          "On a laptop with two GPUs, make Java use the dedicated one: Windows Settings → System → Display → Graphics → add javaw.exe → High performance.",
          "If you just installed shaders (Iris/OptiFine), turn them off and try again.",
        ],
        evidence: lineOf(text, m.index),
      });
    }
    return out;
  });

  // Process exit codes from the launcher
  rules.push(function exitCodes(text) {
    const m = firstMatch(text, /(?:exit(?:ed)? (?:with )?code|Exit code)[: ]+(-?\d+)/i);
    if (!m) return [];
    const code = m[1];
    const known = {
      "-1073741819": ["Native crash (access violation)", "Usually a graphics driver bug, or a mod with native code (like shaders). Update your graphics driver and try without shaders."],
      "-1073740791": ["Native crash (stack buffer overrun)", "Usually a graphics driver or overlay (Discord, RivaTuner, OBS) problem. Update drivers and close overlays."],
      "-1073741571": ["Stack overflow", "Something got stuck in a loop. Often two mods fighting each other. Check the findings above for which mods are involved."],
      "-805306369": ["The game froze and Windows closed it", "Usually not enough RAM or the PC is overwhelmed. Give Minecraft more RAM and lower render distance."],
      "1": ["The game closed with an error", "Look at the other findings, or the last ERROR lines in the log."],
      "137": ["Killed (out of memory)", "Your system ran out of RAM and killed Minecraft. Give it less RAM than your PC has, and close other programs."],
      "134": ["Java aborted", "Usually a driver or native library crash. Update your graphics driver."],
    };
    if (!known[code]) return [];
    return [{
      severity: code === "1" ? "info" : "likely",
      title: `Exit code ${code}: ${known[code][0]}`,
      explain: known[code][1],
      fixes: [],
      evidence: lineOf(text, m.index),
    }];
  });

  // Ticking entity / block entity crashes (a broken thing in the world)
  rules.push(function ticking(text) {
    const m = firstMatch(text, /Description: (Ticking (?:block )?entity|Ticking player|Exception ticking world|Ticking screen)/);
    if (!m) return [];
    const ent = firstMatch(text, /Entity Type: ([\w:]+)/) || firstMatch(text, /Name: ([\w:]+) \/\/ /);
    const pos = firstMatch(text, /Entity's Exact location: ([^\n]+)|Block location: ([^\n]+)/);
    return [{
      severity: "likely",
      title: `Something in your world crashed the game (${m[1].toLowerCase()})`,
      explain: `A ${ent ? ent[1] : "mob or block"}${pos ? ` at ${(pos[1] || pos[2]).trim()}` : ""} errored while the game was updating it.`,
      fixes: [
        "Look at the 'likely mod' finding below to see which mod that thing comes from, and update it.",
        "Make a backup of your world before trying fixes.",
      ],
      evidence: lineOf(text, m.index),
    }];
  });

  // Forge-style "Suspected Mods"
  rules.push(function suspected(text) {
    const m = firstMatch(text, /Suspected Mods?:\s*([^\n]+(?:\n\t[^\n]+)*)/);
    if (!m || /NONE/i.test(m[1])) return [];
    const names = m[1].split("\n").map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s*\(.*$/, "").replace(/,\s*Version.*$/, ""));
    return [{
      severity: "likely",
      title: `The crash report blames: ${names.join(", ")}`,
      explain: "Minecraft looked at where the crash happened and these mods were involved.",
      fixes: [`Update ${names.length > 1 ? "those mods" : names[0]}.`, `If that doesn't help, remove ${names.length > 1 ? "them one at a time" : "it"} to confirm.`],
      evidence: lineOf(text, m.index),
    }];
  });

  // Mixin handler names in stack frames contain the mod id: handler$abc000$modid$method
  rules.push(function mixinFrames(text) {
    const re = /\b(?:handler|redirect|modify\w*|wrapOperation|wrapWithCondition|localvar|inject|constant)\$[a-z0-9]{3,}\$([a-z][a-z0-9_\-]{1,63})\$/g;
    let m;
    const counts = {};
    while ((m = re.exec(text))) counts[m[1]] = (counts[m[1]] || 0) + 1;
    const mods = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (!mods.length) return [];
    return [{
      severity: "likely",
      title: `Mods whose code was running when it crashed: ${mods.slice(0, 4).join(", ")}`,
      explain: "These mods had injected code in the part of Minecraft that crashed. The first one is the best suspect.",
      fixes: [`Update ${mods[0]}.`, `If that doesn't fix it, temporarily remove ${mods[0]} to see if the crash stops.`],
      evidence: null,
    }];
  });

  // Fallback: first non-vanilla package in the stack trace
  rules.push(function stackGuess(text, info, found) {
    if (found.some((f) => f.severity === "fix")) return [];
    const re = /^\s*at ([\w.$]+)\.[\w$<>]+\(/gm;
    let m;
    while ((m = re.exec(text))) {
      const cls = m[1];
      if (VANILLA_PREFIXES.some((p) => cls.startsWith(p))) continue;
      if (/^(?:net\.fabricmc\.fabric\.|com\.llamalad7)/.test(cls)) continue;
      const hit = lookupPackage(cls);
      const name = hit ? hit.mod : cls.split(".").slice(0, 3).join(".");
      return [{
        severity: "likely",
        title: `Likely mod: ${name}`,
        explain: `The first mod code in the crash's stack trace is ${cls}. That's usually the mod that crashed, or the one closest to the problem.`,
        fixes: [`Update ${name}.`, `If it keeps happening, remove it and see if the crash stops.`],
        link: hit ? modrinthLink(hit.slug) : null,
        evidence: lineOf(text, m.index),
      }];
    }
    return [];
  });

  // OptiFine on Fabric / with Sodium
  rules.push(function optifine(text) {
    if (!/optifine|OptiFabric/i.test(text)) return [];
    if (!/sodium|iris|Fabric Loader/i.test(text)) return [];
    return [{
      severity: "likely",
      title: "OptiFine is installed with Fabric",
      explain: "OptiFine (and OptiFabric) break lots of Fabric mods, especially Sodium and Iris.",
      fixes: ["Remove OptiFine and OptiFabric.", "Use Sodium for FPS and Iris for shaders instead. They do the same job and work with other mods."],
      evidence: null,
    }];
  });

  // The headline exception, so people always see something
  rules.push(function headline(text, info, found) {
    const desc = firstMatch(text, /Description: ([^\n]+)\n\s*\n?([\w.$]+(?:Exception|Error)[^\n]*)/);
    if (desc) {
      return [{
        severity: "info",
        title: `What the crash report says: "${desc[1].trim()}"`,
        explain: desc[2].trim(),
        fixes: [],
        evidence: null,
      }];
    }
    if (found.length) return [];
    const ex = firstMatch(text, /((?:[\w$]+\.)+[\w$]*(?:Exception|Error)):? ?([^\n]*)/);
    if (ex) {
      return [{
        severity: "info",
        title: `The error: ${ex[1].split(".").pop()}`,
        explain: ex[0].trim(),
        fixes: [],
        evidence: null,
      }];
    }
    return [];
  });

  function analyze(text) {
    text = String(text || "").replace(/\r\n?/g, "\n");
    const info = readInfo(text);
    const findings = [];
    for (const rule of rules) {
      try {
        for (const f of rule(text, info, findings)) findings.push(f);
      } catch (e) {
        if (typeof console !== "undefined") console.warn("Rule failed:", rule.name, e);
      }
    }

    // Checks based on the info block
    const javaMajor = info.java ? parseInt(info.java.split(".")[0] === "1" ? info.java.split(".")[1] : info.java.split(".")[0], 10) : null;
    const mcParts = info.minecraft ? info.minecraft.split(".").map(Number) : null;
    if (javaMajor && mcParts && mcParts[0] === 1) {
      const minor = mcParts[1], patch = mcParts[2] || 0;
      const need = minor > 20 || (minor === 20 && patch >= 5) ? 21 : minor >= 18 ? 17 : minor === 17 ? 16 : 8;
      if (javaMajor < need && !findings.some((f) => /Java/.test(f.title))) {
        findings.unshift({
          severity: "fix",
          title: `Minecraft ${info.minecraft} needs Java ${need}, but you're using Java ${javaMajor}`,
          explain: "Running Minecraft on too old a Java will crash it.",
          fixes: [`Set the instance's Java to version ${need} in your launcher.`],
          evidence: null,
        });
      }
    }

    const order = { fix: 0, likely: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    return { info, findings };
  }

  const api = { analyze, readInfo, lookupPackage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CrashAnalyzer = api;
})(typeof window !== "undefined" ? window : globalThis);
