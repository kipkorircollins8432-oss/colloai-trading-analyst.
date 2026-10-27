
"use strict";

(() => {
  const TIMEFRAMES = [
    { code: "MN", label: "Monthly" },
    { code: "W1", label: "Weekly" },
    { code: "D1", label: "Daily" },
    { code: "M30", label: "30 Minutes" },
    { code: "M15", label: "15 Minutes" },
    { code: "M5", label: "5 Minutes" },
    { code: "M1", label: "1 Minute" }
  ];

  const MAX_FILES = 7;
  const MAX_FILE_SIZE = 8 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_CHARS = 3000000;
  const HISTORY_KEY = "colloai_reports_v2";

  let selectedFiles = [];
  let busy = false;
  let objectUrls = [];

  const $ = (selectors, root = document) => {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    return null;
  };

  function findFileInput() {
    return $([
      "#chartFiles",
      "#screenshots",
      "#chartScreenshots",
      "#imageUpload",
      'input[type="file"]'
    ]);
  }

  function getControls() {
    return {
      symbol: $([
        "#symbol", "#instrument",
        '[name="symbol"]', '[name="instrument"]'
      ]),
      mode: $([
        "#mode", "#tradingStyle", "#tradingMode",
        '[name="mode"]', '[name="tradingStyle"]'
      ]),
      price: $([
        "#currentPrice", "#price", '[name="currentPrice"]'
      ])
    };
  }

  function setStatus(message, type = "") {
    let element = document.getElementById("colloai-upload-status");

    if (!element) {
      element = document.createElement("div");
      element.id = "colloai-upload-status";
      const input = findFileInput();
      if (input) input.insertAdjacentElement("afterend", element);
      else document.body.prepend(element);
    }

    element.textContent = message;
    element.className = type ? `colloai-${type}` : "";
    element.setAttribute("role", "status");
  }

  function getFileList() {
    let list = document.getElementById("colloai-file-list");

    if (!list) {
      list = document.createElement("div");
      list.id = "colloai-file-list";
      const status = document.getElementById("colloai-upload-status");
      const input = findFileInput();

      if (status) status.insertAdjacentElement("afterend", list);
      else if (input) input.insertAdjacentElement("afterend", list);
    }

    return list;
  }

  function getReport() {
    let report = document.getElementById("colloai-report");

    if (!report) {
      report = document.createElement("section");
      report.id = "colloai-report";
      report.hidden = true;
      getFileList().insertAdjacentElement("afterend", report);
    }

    return report;
  }

  function addStyles() {
    if (document.getElementById("colloai-runtime-styles")) return;

    const style = document.createElement("style");
    style.id = "colloai-runtime-styles";
    style.textContent = `
      #colloai-file-list {
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
        gap:14px;
        margin:18px 0;
      }
      .colloai-file-card {
        min-width:0;padding:12px;border:1px solid #394257;
        border-radius:12px;background:#101727;color:#f4f6fb;
      }
      .colloai-file-card img {
        display:block;width:100%;max-height:220px;object-fit:contain;
        margin:10px 0;border-radius:8px;background:#080d17;
      }
      .colloai-file-card select {
        display:block;width:100%;padding:10px;margin:8px 0;
        color:inherit;background:#080d17;border:1px solid #59647b;
        border-radius:8px;
      }
      .colloai-file-name { overflow-wrap:anywhere;font-size:13px;color:#c6ccda; }
      .colloai-remove { padding:8px 12px;border:1px solid #b65c65;
        border-radius:8px;color:#ffd8dc;background:#351c27; }
      #colloai-upload-status { margin:12px 0;line-height:1.6; }
      #colloai-report { margin-top:24px;padding:18px;border:1px solid #394257;
        border-radius:12px;background:#101727;color:#f4f6fb;line-height:1.7;
        overflow-wrap:anywhere; }
      #colloai-report pre { white-space:pre-wrap;overflow-wrap:anywhere;font:inherit; }
      #colloai-report button { margin:10px 8px 0 0;padding:10px 14px;border-radius:8px; }
      .colloai-muted { color:#aab3c5; }
      .colloai-error { color:#ff9999; }
      .colloai-success { color:#8fe3b0; }
    `;
    document.head.appendChild(style);
  }

  function readSymbol() {
    const raw = getControls().symbol?.value?.trim() || "XAUUSD";
    const value = raw.replace(/\s*[—–-]\s*.*/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "").toUpperCase();
    return /^[A-Z0-9._-]{2,20}$/.test(value) ? value : "XAUUSD";
  }

  function readMode() {
    const raw = (getControls().mode?.value || "Intraday").toLowerCase();
    if (raw.includes("scalp")) return "Scalping";
    if (raw.includes("swing")) return "Swing";
    return "Intraday";
  }

  function readPrice() {
    const value = getControls().price?.value?.trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  function makeElement(tag, text = "", className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function inferTimeframe(filename, used) {
    const name = filename.toLowerCase();
    const patterns = [
      [/(monthly|month|\bmn\b|1mo)/, "MN"],
      [/(weekly|week|\bw1\b|1w)/, "W1"],
      [/(daily|\bday\b|\bd1\b|1d)/, "D1"],
      [/(30m|\bm30\b|30min)/, "M30"],
      [/(15m|\bm15\b|15min)/, "M15"],
      [/(5m|\bm5\b|5min)/, "M5"],
      [/(1m|\bm1\b|1min)/, "M1"]
    ];

    for (const [pattern, code] of patterns) {
      if (pattern.test(name) && !used.has(code)) return code;
    }

    return TIMEFRAMES.find(item => !used.has(item.code))?.code || "M1";
  }

  function renderFiles() {
    const list = getFileList();
    list.replaceChildren();

    // Revoke previous preview URLs to avoid memory leaks.
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];

    if (!selectedFiles.length) {
      setStatus("No screenshots selected. Upload at least one chart.");
      return;
    }

    const used = new Set();

    selectedFiles.forEach((item, index) => {
      if (!TIMEFRAMES.some(tf => tf.code === item.timeframe)) {
        item.timeframe = inferTimeframe(item.file.name, used);
      }
      used.add(item.timeframe);

      const card = makeElement("div", "", "colloai-file-card");
      card.appendChild(makeElement("strong", `Chart ${index + 1}`));
      card.appendChild(makeElement("div", item.file.name, "colloai-file-name"));

      const preview = document.createElement("img");
      preview.alt = `Preview of ${item.file.name}`;

      const previewUrl = URL.createObjectURL(item.file);
      objectUrls.push(previewUrl);
      preview.src = previewUrl;
      card.appendChild(preview);

      card.appendChild(makeElement("label", "Timeframe"));
      const select = document.createElement("select");
      select.setAttribute("aria-label", `Timeframe for ${item.file.name}`);

      TIMEFRAMES.forEach(tf => {
        const option = document.createElement("option");
        option.value = tf.code;
        option.textContent = tf.label;
        option.selected = item.timeframe === tf.code;
        select.appendChild(option);
      });

      select.addEventListener("change", () => {
        item.timeframe = select.value;
        renderFiles();
      });

      const remove = makeElement("button", "Remove screenshot", "colloai-remove");
      remove.type = "button";
      remove.addEventListener("click", () => {
        selectedFiles = selectedFiles.filter(file => file !== item);
        renderFiles();
      });

      card.append(select, remove);
      list.appendChild(card);
    });

    setStatus(
      `${selectedFiles.length} screenshot(s) selected. Check each timeframe.`,
      "success"
    );
  }

  function acceptFiles(fileList) {
    const supported = ["image/jpeg", "image/png", "image/webp"];
    const errors = [];

    for (const file of Array.from(fileList || [])) {
      const typeOkay = supported.includes(file.type) ||
        /\.(jpe?g|png|webp)$/i.test(file.name);

      if (!typeOkay) {
        errors.push(`${file.name}: use JPG, PNG or WebP.`);
        continue;
      }

      if (file.size === 0 || file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: image must be between 1 byte and 8 MB.`);
        continue;
      }

      if (selectedFiles.some(item =>
        item.file.name === file.name && item.file.size === file.size
      )) continue;

      if (selectedFiles.length >= MAX_FILES) {
        errors.push("Maximum seven screenshots allowed.");
        break;
      }

      selectedFiles.push({ file, timeframe: "" });
    }

    renderFiles();
    if (errors.length) setStatus(errors.join(" "), "error");
  }

  async function decodeImage(file) {
    // Preferred method: decode the original file directly.
    if ("createImageBitmap" in window) {
      try {
        return await createImageBitmap(file);
      } catch (error) {
        console.warn("createImageBitmap failed; trying Image fallback.", error);
      }
    }

    // Fallback for browsers that cannot decode with createImageBitmap.
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        URL.revokeObjectURL(url);
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error(`The image ${file.name} has no readable dimensions.`));
        } else {
          resolve(image);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(
          `Your browser could not decode ${file.name}. Open it in Gallery and save/export it as JPG or PNG, then upload the saved copy.`
        ));
      };

      image.src = url;
    });
  }

  async function compressImage(file, timeframe) {
    let image;

    try {
      image = await decodeImage(file);

      const width = image.width || image.naturalWidth;
      const height = image.height || image.naturalHeight;

      if (!width || !height) {
        throw new Error(`Cannot determine the dimensions of ${file.name}.`);
      }

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) throw new Error("Your browser cannot prepare this image.");

      let maxDimension = 1400;
      let quality = 0.78;
      let dataUrl = "";

      for (let attempt = 0; attempt < 10; attempt++) {
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        dataUrl = canvas.toDataURL("image/jpeg", quality);

        if (dataUrl.length <= 450000) break;

        if (quality > 0.5) quality -= 0.08;
        else maxDimension = Math.max(400, maxDimension - 150);
      }

      if (!dataUrl || dataUrl.length > 650000) {
        throw new Error(
          `${file.name} could not be compressed enough. Try a smaller screenshot.`
        );
      }

      return { timeframe, image: dataUrl };
    } finally {
      if (image && typeof image.close === "function") image.close();
    }
  }

  async function analyzeCharts() {
    if (busy) return;

    if (!selectedFiles.length) {
      setStatus("Please upload at least one chart screenshot.", "error");
      return;
    }

    const used = new Set();
    for (const item of selectedFiles) {
      if (!item.timeframe) {
        setStatus("Choose a timeframe for every screenshot.", "error");
        return;
      }
      if (used.has(item.timeframe)) {
        setStatus("Each screenshot must have a different timeframe.", "error");
        return;
      }
      used.add(item.timeframe);
    }

    busy = true;
    const report = getReport();
    report.hidden = false;
    report.replaceChildren(makeElement("h2", "ColloAI Analysis"));

    const analyzeButton = Array.from(document.querySelectorAll("button"))
      .find(button => /analyze my charts/i.test(button.textContent || ""));

    if (analyzeButton) {
      analyzeButton.disabled = true;
      analyzeButton.dataset.originalText = analyzeButton.textContent;
      analyzeButton.textContent = "Analyzing…";
    }

    try {
      const charts = [];

      for (const item of selectedFiles) {
        setStatus(`Preparing ${item.timeframe} screenshot…`);
        charts.push(await compressImage(item.file, item.timeframe));
      }

      charts.sort((a, b) =>
        TIMEFRAMES.findIndex(tf => tf.code === a.timeframe) -
        TIMEFRAMES.findIndex(tf => tf.code === b.timeframe)
      );

      const total = charts.reduce((sum, chart) => sum + chart.image.length, 0);
      if (total > MAX_TOTAL_IMAGE_CHARS) {
        throw new Error("Images are too large together. Upload fewer screenshots.");
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: readSymbol(),
          mode: readMode(),
          currentPrice: readPrice(),
          charts
        })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || `Analysis request failed (${response.status}).`);
      }

      if (!result.report || typeof result.report !== "string") {
        throw new Error("The AI returned an empty report.");
      }

      displayReport(result);
      saveReport({
        symbol: result.symbol,
        mode: result.mode,
        report: result.report,
        timestamp: result.timestamp || new Date().toISOString(),
        analyzedTimeframes: result.analyzedTimeframes || charts.map(c => c.timeframe)
      });

      setStatus("Analysis completed successfully.", "success");
    } catch (error) {
      report.replaceChildren(
        makeElement("h2", "Analysis could not be completed"),
        makeElement("p", error.message || "Unknown error.", "colloai-error")
      );
      setStatus(error.message || "Please try again.", "error");
    } finally {
      busy = false;
      if (analyzeButton) {
        analyzeButton.disabled = false;
        analyzeButton.textContent =
          analyzeButton.dataset.originalText || "Analyze my charts";
      }
    }
  }

  function displayReport(result) {
    const report = getReport();
    report.hidden = false;
    report.replaceChildren(
      makeElement("h2", "ColloAI Analysis Report"),
      makeElement(
        "p",
        `Instrument: ${result.symbol} | Mode: ${result.mode} | ` +
        new Date(result.timestamp || Date.now()).toLocaleString(),
        "colloai-muted"
      ),
      makeElement("pre", result.report)
    );

    const copy = makeElement("button", "Copy report");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.report);
        setStatus("Report copied.", "success");
      } catch {
        setStatus("Clipboard blocked. Select and copy the report manually.", "error");
      }
    });

    const historyButton = makeElement("button", "View saved reports");
    historyButton.type = "button";
    historyButton.addEventListener("click", showHistory);

    report.append(copy, historyButton);
    report.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveReport(item) {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      history.unshift(item);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
    } catch (error) {
      console.warn("Could not save report:", error);
    }
  }

  function showHistory() {
    const report = getReport();
    report.hidden = false;
    report.replaceChildren(makeElement("h2", "Saved Reports"));

    let history = [];
    try {
      history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {}

    if (!history.length) {
      report.appendChild(makeElement("p", "No saved reports yet."));
      return;
    }

    history.forEach(item => {
      const card = makeElement("div", "", "colloai-file-card");
      card.appendChild(makeElement("strong", `${item.symbol} — ${item.mode}`));
      card.appendChild(makeElement(
        "p",
        new Date(item.timestamp).toLocaleString(),
        "colloai-muted"
      ));

      const open = makeElement("button", "Open report");
      open.type = "button";
      open.addEventListener("click", () => displayReport(item));
      card.appendChild(open);
      report.appendChild(card);
    });
  }

  function initialize() {
    addStyles();

    const input = findFileInput();
    if (!input) {
      setStatus("Upload control not found. Check the file input in index.html.", "error");
      return;
    }

    input.multiple = true;
    input.accept = "image/jpeg,image/png,image/webp";

    input.addEventListener("change", event => {
      acceptFiles(event.target.files);
      input.value = "";
    });

    const button = Array.from(document.querySelectorAll("button"))
      .find(item => /analyze my charts/i.test(item.textContent || ""));

    if (button) {
      button.addEventListener("click", event => {
        event.preventDefault();
        analyzeCharts();
      });
    }

    const form = input.closest("form");
    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        analyzeCharts();
      });
    }

    getFileList();
    getReport();
    setStatus("Upload 1–7 screenshots, assign timeframes, then analyze.");
    console.log("ColloAI initialized.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();


