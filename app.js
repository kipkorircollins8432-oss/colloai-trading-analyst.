
"use strict";

(() => {
  const TFS = [
    ["MN", "Monthly"], ["W1", "Weekly"], ["D1", "Daily"],
    ["M30", "30 Minutes"], ["M15", "15 Minutes"],
    ["M5", "5 Minutes"], ["M1", "1 Minute"]
  ];
  const MAX_FILES = 7;
  const MAX_SIZE = 8 * 1024 * 1024;
  const HISTORY_KEY = "colloai_reports_v2";
  let files = [];
  let busy = false;

  const $ = (s, root = document) => {
    for (const selector of s) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  const input = () => $([
    "#chartFiles", "#screenshots", "#chartScreenshots",
    "#imageUpload", 'input[type="file"]'
  ]);

  const controls = () => ({
    symbol: $(["#symbol", "#instrument", '[name="symbol"]']),
    mode: $(["#mode", "#tradingStyle", "#tradingMode", '[name="mode"]']),
    price: $(["#currentPrice", "#price", '[name="currentPrice"]'])
  });

  function el(tag, text = "", cls = "") {
    const node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }

  function status(message, type = "") {
    let node = document.getElementById("colloai-upload-status");
    if (!node) {
      node = el("div");
      node.id = "colloai-upload-status";
      const fileInput = input();
      if (fileInput) fileInput.insertAdjacentElement("afterend", node);
      else document.body.prepend(node);
    }
    node.textContent = message;
    node.className = type ? `colloai-${type}` : "";
    node.setAttribute("role", "status");
  }

  function fileList() {
    let node = document.getElementById("colloai-file-list");
    if (!node) {
      node = el("div");
      node.id = "colloai-file-list";
      const s = document.getElementById("colloai-upload-status");
      if (s) s.insertAdjacentElement("afterend", node);
      else if (input()) input().insertAdjacentElement("afterend", node);
    }
    return node;
  }

  function reportBox() {
    let node = document.getElementById("colloai-report");
    if (!node) {
      node = el("section");
      node.id = "colloai-report";
      node.hidden = true;
      fileList().insertAdjacentElement("afterend", node);
    }
    return node;
  }

  function styles() {
    if (document.getElementById("colloai-runtime-styles")) return;
    const style = el("style");
    style.id = "colloai-runtime-styles";
    style.textContent = `
      #colloai-file-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:18px 0}
      .colloai-file-card{min-width:0;padding:12px;border:1px solid #394257;border-radius:12px;background:#101727;color:#f4f6fb}
      .colloai-file-card img{display:block;width:100%;max-height:220px;object-fit:contain;margin:10px 0;border-radius:8px;background:#080d17}
      .colloai-file-card select{width:100%;padding:10px;margin:8px 0;color:inherit;background:#080d17;border:1px solid #59647b;border-radius:8px}
      .colloai-file-name{overflow-wrap:anywhere;font-size:13px;color:#c6ccda}
      .colloai-remove{padding:8px 12px;border:1px solid #b65c65;border-radius:8px;color:#ffd8dc;background:#351c27}
      #colloai-upload-status{margin:12px 0;line-height:1.6}
      #colloai-report{margin-top:24px;padding:18px;border:1px solid #394257;border-radius:12px;background:#101727;color:#f4f6fb;line-height:1.7;overflow-wrap:anywhere}
      #colloai-report pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
      #colloai-report button{margin:10px 8px 0 0;padding:10px 14px;border-radius:8px}
      .colloai-muted{color:#aab3c5}.colloai-error{color:#ff9999}.colloai-success{color:#8fe3b0}
    `;
    document.head.appendChild(style);
  }

  function symbol() {
    const raw = controls().symbol?.value?.trim() || "XAUUSD";
    const value = raw.replace(/\s*[—–-]\s*.*/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "").toUpperCase();
    return /^[A-Z0-9._-]{2,20}$/.test(value) ? value : "XAUUSD";
  }

  function mode() {
    const raw = (controls().mode?.value || "Intraday").toLowerCase();
    if (raw.includes("scalp")) return "Scalping";
    if (raw.includes("swing")) return "Swing";
    return "Intraday";
  }

  function price() {
    const value = controls().price?.value?.trim();
    if (!value) return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Read the original file bytes without decoding or canvas compression.
  // This avoids the browser image-decoding failure seen on some phones.
  function readOriginal(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== "string" ||
            !/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(dataUrl)) {
          reject(new Error(
            `${file.name}: the file is not a supported JPEG, PNG, or WebP image.`
          ));
          return;
        }
        resolve(dataUrl);
      };

      reader.onerror = () => reject(new Error(
        `Your phone could not read ${file.name}. Please select the file again.`
      ));

      reader.readAsDataURL(file);
    });
  }

  function guessTF(filename, used) {
    const n = filename.toLowerCase();
    const rules = [
      [/(monthly|month|\bmn\b|1mo)/, "MN"],
      [/(weekly|week|\bw1\b|1w)/, "W1"],
      [/(daily|\bd1\b|1d)/, "D1"],
      [/(30m|\bm30\b|30min)/, "M30"],
      [/(15m|\bm15\b|15min)/, "M15"],
      [/(5m|\bm5\b|5min)/, "M5"],
      [/(1m|\bm1\b|1min)/, "M1"]
    ];
    for (const [pattern, code] of rules) {
      if (pattern.test(n) && !used.has(code)) return code;
    }
    return TFS.find(([code]) => !used.has(code))?.[0] || "M1";
  }

  function render() {
    const list = fileList();
    list.replaceChildren();

    if (!files.length) {
      status("No screenshots selected. Upload at least one chart.");
      return;
    }

    const used = new Set();

    files.forEach((item, index) => {
      if (!TFS.some(([code]) => code === item.tf)) {
        item.tf = guessTF(item.file.name, used);
      }
      used.add(item.tf);

      const card = el("div", "", "colloai-file-card");
      card.append(el("strong", `Chart ${index + 1}`));
      card.append(el("div", item.file.name, "colloai-file-name"));

      // Preview uses the browser's built-in display support only.
      // Analysis itself does not depend on preview decoding.
      const preview = document.createElement("img");
      preview.alt = `Preview: ${item.file.name}`;
      preview.src = URL.createObjectURL(item.file);
      item.previewUrl = preview.src;
      preview.onerror = () => {
        preview.hidden = true;
        card.append(el("p", "Preview unavailable; the original file can still be submitted."));
      };
      card.append(preview);

      const select = document.createElement("select");
      select.setAttribute("aria-label", `Timeframe for ${item.file.name}`);
      TFS.forEach(([code, label]) => {
        const option = el("option", label);
        option.value = code;
        option.selected = item.tf === code;
        select.append(option);
      });
      select.addEventListener("change", () => {
        item.tf = select.value;
        render();
      });

      const remove = el("button", "Remove screenshot", "colloai-remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        files = files.filter(f => f !== item);
        render();
      });

      card.append(select, remove);
      list.append(card);
    });

    status(`${files.length} screenshot(s) selected. Check each timeframe.`, "success");
  }

  function accept(selected) {
    const errors = [];
    for (const file of Array.from(selected || [])) {
      const supported = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        /\.(jpe?g|png|webp)$/i.test(file.name);

      if (!supported) {
        errors.push(`${file.name}: select a JPG, PNG or WebP file.`);
        continue;
      }
      if (!file.size || file.size > MAX_SIZE) {
        errors.push(`${file.name}: file must be smaller than 8 MB.`);
        continue;
      }
      if (files.some(f => f.file.name === file.name && f.file.size === file.size)) continue;
      if (files.length >= MAX_FILES) {
        errors.push("You can upload up to seven screenshots.");
        break;
      }
      files.push({ file, tf: "" });
    }
    render();
    if (errors.length) status(errors.join(" "), "error");
  }

  async function analyze() {
    if (busy) return;
    if (!files.length) {
      status("Upload at least one screenshot first.", "error");
      return;
    }

    const used = new Set();
    for (const item of files) {
      if (!item.tf) {
        status("Choose a timeframe for every screenshot.", "error");
        return;
      }
      if (used.has(item.tf)) {
        status("Each screenshot must have a different timeframe.", "error");
        return;
      }
      used.add(item.tf);
    }

    busy = true;
    const box = reportBox();
    box.hidden = false;
    box.replaceChildren(el("h2", "ColloAI Analysis"));

    const button = Array.from(document.querySelectorAll("button"))
      .find(b => /analyze my charts/i.test(b.textContent || ""));

    if (button) {
      button.disabled = true;
      button.dataset.oldText = button.textContent;
      button.textContent = "Analyzing…";
    }

    try {
      const charts = [];
      let totalChars = 0;

      for (const item of files) {
        status(`Reading original ${item.tf} screenshot…`);
        const image = await readOriginal(item.file);
        totalChars += image.length;
        charts.push({ timeframe: item.tf, image });
      }

      // Vercel functions commonly enforce a request body limit.
      // Stop early instead of sending a request likely to be rejected.
      if (totalChars > 3000000) {
        throw new Error(
          "These original screenshots are too large to send together. Try fewer screenshots or smaller screenshots."
        );
      }

      status("Sending original screenshots to the AI engine…");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol(),
          mode: mode(),
          currentPrice: price(),
          charts
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Analysis request failed (${response.status}).`);
      }
      if (typeof result.report !== "string" || !result.report.trim()) {
        throw new Error("The AI returned an empty report.");
      }

      showReport(result);
      saveReport({
        symbol: result.symbol,
        mode: result.mode,
        report: result.report,
        timestamp: result.timestamp || new Date().toISOString(),
        analyzedTimeframes: result.analyzedTimeframes || charts.map(c => c.timeframe)
      });
      status("Analysis completed.", "success");
    } catch (error) {
      box.replaceChildren(
        el("h2", "Analysis could not be completed"),
        el("p", error.message || "Unknown error.", "colloai-error")
      );
      status(error.message || "Please try again.", "error");
    } finally {
      busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = button.dataset.oldText || "Analyze my charts";
      }
    }
  }

  function showReport(result) {
    const box = reportBox();
    box.hidden = false;
    box.replaceChildren(
      el("h2", "ColloAI Analysis Report"),
      el("p",
        `Instrument: ${result.symbol} | Mode: ${result.mode} | ` +
        new Date(result.timestamp || Date.now()).toLocaleString(),
        "colloai-muted"
      ),
      el("pre", result.report)
    );

    const copy = el("button", "Copy report");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.report);
        status("Report copied.", "success");
      } catch {
        status("Clipboard unavailable. Select and copy the report manually.", "error");
      }
    });

    const historyButton = el("button", "View saved reports");
    historyButton.type = "button";
    historyButton.addEventListener("click", showHistory);
    box.append(copy, historyButton);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveReport(item) {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      history.unshift(item);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
    } catch (error) {
      console.warn("Could not save report history:", error);
    }
  }

  function showHistory() {
    const box = reportBox();
    box.hidden = false;
    box.replaceChildren(el("h2", "Saved Reports"));

    let history = [];
    try {
      history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {}

    if (!history.length) {
      box.append(el("p", "No saved reports yet."));
      return;
    }

    history.forEach(item => {
      const card = el("div", "", "colloai-file-card");
      card.append(
        el("strong", `${item.symbol} — ${item.mode}`),
        el("p", new Date(item.timestamp).toLocaleString(), "colloai-muted")
      );
      const open = el("button", "Open report");
      open.type = "button";
      open.addEventListener("click", () => showReport(item));
      card.append(open);
      box.append(card);
    });
  }

  function init() {
    styles();
    const fileInput = input();

    if (!fileInput) {
      status("Upload control not found. Check index.html.", "error");
      return;
    }

    fileInput.multiple = true;
    fileInput.accept = "image/jpeg,image/png,image/webp";

    fileInput.addEventListener("change", event => {
      accept(event.target.files);
      fileInput.value = "";
    });

    const button = Array.from(document.querySelectorAll("button"))
      .find(b => /analyze my charts/i.test(b.textContent || ""));

    if (button) {
      button.addEventListener("click", event => {
        event.preventDefault();
        analyze();
      });
    }

    const form = fileInput.closest("form");
    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        analyze();
      });
    }

    fileList();
    reportBox();
    status("Upload 1–7 screenshots, select their timeframes, then analyze.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
