(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const log = $("log");
  const results = $("results");

  const LABEL = { fix: "Fix this", likely: "Likely cause", info: "Good to know" };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(text) {
    const { info, findings } = window.CrashAnalyzer.analyze(text);

    const infoBox = $("info");
    infoBox.replaceChildren();
    const facts = [
      ["Type", info.kind],
      ["Minecraft", info.minecraft],
      ["Loader", info.loader ? `${info.loader}${info.loaderVersion ? " " + info.loaderVersion : ""}` : null],
      ["Java", info.java],
      ["Mods", info.mods],
    ];
    for (const [k, v] of facts) {
      if (v == null) continue;
      const f = el("div", "fact");
      f.append(el("span", "k", k), el("span", "v", String(v)));
      infoBox.append(f);
    }

    const list = $("findings");
    list.replaceChildren();
    if (!findings.length) {
      const empty = el("div", "finding none");
      empty.append(
        el("h3", null, "No known problem found"),
        el("p", null, "This log doesn't match anything we recognize yet. Make sure you pasted the whole thing (crash reports start with \"---- Minecraft Crash Report ----\"). If it really is a crash, send it to us so we can add it."),
      );
      list.append(empty);
    }
    for (const f of findings) {
      const card = el("article", `finding ${f.severity}`);
      card.append(el("span", "badge", LABEL[f.severity]));
      card.append(el("h3", null, f.title));
      if (f.explain) card.append(el("p", null, f.explain));
      if (f.fixes && f.fixes.length) {
        const ul = el("ul", "fixes");
        f.fixes.forEach((x) => ul.append(el("li", null, x)));
        card.append(ul);
      }
      if (f.link) {
        const a = el("a", "dl", "Get it on Modrinth →");
        a.href = f.link;
        a.target = "_blank";
        a.rel = "noopener";
        card.append(a);
      }
      if (f.evidence) {
        const d = el("details");
        d.append(el("summary", null, "Where we saw this"), el("code", null, f.evidence));
        card.append(d);
      }
      list.append(card);
    }
    results.hidden = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("go").addEventListener("click", () => {
    if (!log.value.trim()) {
      log.focus();
      log.classList.add("shake");
      setTimeout(() => log.classList.remove("shake"), 400);
      return;
    }
    render(log.value);
  });

  function loadFile(file) {
    if (!file) return;
    file.text().then((t) => {
      log.value = t;
      render(t);
    });
  }

  $("file").addEventListener("change", (e) => loadFile(e.target.files[0]));

  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("over");
  }));
  drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));

  document.querySelectorAll("[data-sample]").forEach((b) =>
    b.addEventListener("click", async () => {
      const r = await fetch("samples/" + b.dataset.sample);
      const t = await r.text();
      log.value = t;
      render(t);
    }));

  log.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("go").click();
  });
})();
