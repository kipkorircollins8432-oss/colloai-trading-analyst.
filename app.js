
"use strict";

/*
 * ColloAI Trading Analyst — app.js
 * Supports 1–7 screenshots, timeframe assignment,
 * image compression, AI requests and report history.
 */

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
  const MAX_ORIGINAL_FILE_SIZE = 8 * 1024 * 1024;
  const MAX_TOTAL_IMAGE_CHARS = 3000000;
  const HISTORY_KEY = "colloai_reports_v2";

  let selectedFiles = [];
  let busy = false;

  const $ = (selectors, root = document) => {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      if (element) return element;
    }
    return null;
  };

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
        min-width:0;
        padding:12px;
        border:1px solid #394257;
        border-radius:12px;
        background:#101727;
        color:#f4f6fb;
      }
      .colloai-file-card img {
        display:block;
        width:100%;
        max-height:220px;
        object-fit:contain;
        margin:10px 0;
        border-radius:8px;
        background:#080d17;
      }
      .colloai-file-card select {
        display:block;
        width:100%;
        padding:10px;
        margin:8px 0;
        color:inherit;
        background:#080d17;
        border:1px solid #59647b;
        border-radius:8px;
      }
      .colloai-file-name {
        overflow-wrap:anywhere;
        font-size:13px;
        color:#c6ccda;
      }
      .colloai-remove {
        padding:8px 12px;
        border:1px solid #b65c65;
        border-radius:8px;
        color:#ffd8dc;
        background:#351c27;
      }
      #colloai-upload-status {
        margin:12px 0;
        line-height:1.6;
      }
      #colloai-report {
        margin-top:24px;
        padding:18px;
        border:1px solid #394257;
        border-radius:12px;
        background:#101727;
        color:#f4f6fb;
        line-height:1.7;
        overflow-wrap:anywhere;
      }
      #colloai-report pre {
        white-space:pre-wrap;
        overflow-wrap:anywhere;
        font:inherit;
      }
      #colloai-report button {
        margin:10px 8px 0 0;
        padding:10px 14px;
        border-radius:8px;
      }
      .colloai-muted { color:#aab3c5; }
      .colloai-error { color:#ff9999; }
      .colloai-success { color:#8fe3b0; }
    `;
    document.head.appendChild(style);
  }

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
    const symbolElement = $([
      "#symbol",
      "#instrument",
      '[name="symbol"]',
      '[name="instrument"]'
    ]);

    const modeElement = $([
      "#mode",
      "#tradingStyle",
      "#tradingMode",
      '[name="mode"]',
      '[name="tradingStyle"]'
    ]);

    const priceElement = $([
      "#currentPrice",
      "#price",
      '[name="currentPrice"]'
    ]);

    return {
      symbolElement,
      modeElement,
      priceElement
    };
  }

  function readSymbol() {
    const { symbolElement } = getControls();
    const raw = symbolElement?.value?.trim() || "XAUUSD";

    const value = raw
      .replace(/\s*[—–-]\s*.*/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .toUpperCase();

    return /^[A-Z0-9._-]{2,20}$/.test(value)
      ? value
      : "XAUUSD";
  }

  function readMode() {
    const { modeElement } = getControls();
    const raw = (modeElement?.value || "Intraday").toLowerCase();

    if (raw.includes("scalp")) return "Scalping";
    if (raw.includes("swing")) return "Swing";
    return "Intraday";
  }

  function readPrice() {
    const { priceElement } = getControls();
    if (!priceElement || priceElement.value.trim() === "") {
      return null;
    }

    const value = Number(priceElement.value);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function getStatusElement() {
    let status = document.getElementById("colloai-upload-status");

    if (!status) {
      status = createElement("div");
      status.id = "colloai-upload-status";

      const input = findFileInput();
      if (input) {
        input.insertAdjacentElement("afterend", status);
      } else {
        document.body.prepend(status);
      }
    }

    return status;
  }

  function setStatus(message, type = "") {
    const status = getStatusElement();
    status.textContent = message;
    status.className = type ? `colloai-${type}` : "";
    status.setAttribute("role", "status");
  }

  function getFileListElement() {
    let list = document.getElementById("colloai-file-list");

    if (!list) {
      list = createElement("div");
      list.id = "colloai-file-list";

      const input = findFileInput();
      const status = getStatusElement();

      if (status.parentNode) {
        status.insertAdjacentElement("afterend", list);
      } else if (input) {
        input.insertAdjacentElement("afterend", list);
      }
    }

    return list;
  }

  function getReportElement() {
    let report = document.getElementById("colloai-report");

    if (!report) {
      report = createElement("section");
      report.id = "colloai-report";
      report.hidden = true;

      const list = getFileListElement();
      list.insertAdjacentElement("afterend", report);
    }

    return report;
  }

  function inferTimeframe(filename, usedCodes) {
    const name = filename.toLowerCase();

    const patterns = [
      [/\b(monthly|month|mn|1mo)\b/, "MN"],
      [/\b(weekly|week|w1|1w)\b/, "W1"],
      [/\b(daily|day|d1|1d)\b/, "D1"],
      [/\b(30m|m30|30min|30-minute)\b/, "M30"],
      [/\b(15m|m15|15min|15-minute)\b/, "M15"],
      [/\b(5m|m5|5min|5-minute)\b/, "M5"],
      [/\b(1m|m1|1min|1-minute)\b/, "M1"]
    ];

    for (const [pattern, code] of patterns) {
      if (pattern.test(name) && !usedCodes.has(code)) {
        return code;
      }
    }

    return TIMEFRAMES.find(item => !usedCodes.has(item.code))?.code
      || "M1";
  }

  function renderFiles() {
    const list = getFileListElement();
    list.replaceChildren();

    if (selectedFiles.length === 0) {
      setStatus("No screenshots selected. Upload at least one chart.");
      return;
    }

    const usedCodes = new Set();

    selectedFiles.forEach((item, index) => {
      if (!TIMEFRAMES.some(tf => tf.code === item.timeframe)) {
        item.timeframe = inferTimeframe(item.file.name, usedCodes);
      }

      usedCodes.add(item.timeframe);

      const card = createElement("div", "colloai-file-card");
      const heading = createElement(
        "strong",
        "",
        `Chart ${index + 1}`
      );
      const filename = createElement(
        "div",
        "colloai-file-name",
        item.file.name
      );

      const preview = document.createElement("img");
      preview.alt = `Preview of ${item.file.name}`;
      preview.src = URL.createObjectURL(item.file);
      item.previewUrl = preview.src;

      const label = createElement("label", "", "Timeframe");
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

      const remove = createElement(
        "button",
        "colloai-remove",
        "Remove screenshot"
      );
      remove.type = "button";

      remove.addEventListener("click", () => {
        selectedFiles = selectedFiles.filter(file => file !== item);
        renderFiles();
      });

      card.append(
        heading,
        filename,
        preview,
        label,
        select,
        remove
      );

      list.appendChild(card);
    });

    setStatus(
      `${selectedFiles.length} screenshot(s) selected. ` +
      "Choose the correct timeframe for each chart.",
      "success"
    );
  }

  function acceptFiles(fileList) {
    const files = Array.from(fileList || []);

    if (!files.length) return;

    const supported = ["image/jpeg", "image/png", "image/webp"];
    const existingNames = new Set(
      selectedFiles.map(item => `${item.file.name}:${item.file.size}`)
    );

    let added = 0;
    const errors = [];

    for (const file of files) {
      if (!supported.includes(file.type)) {
        errors.push(`${file.name}: use JPG, PNG or WebP.`);
        continue;
      }

      if (file.size > MAX_ORIGINAL_FILE_SIZE) {
        errors.push(`${file.name}: original image exceeds 8 MB.`);
        continue;
      }

      const key = `${file.name}:${file.size}`;
      if (existingNames.has(key)) continue;

      if (selectedFiles.length >= MAX_FILES) {
        errors.push("You can upload a maximum of seven screenshots.");
        break;
      }

      selectedFiles.push({
        file,
        timeframe: "",
        previewUrl: null
      });

      existingNames.add(key);
      added++;
    }

    if (errors.length) {
      setStatus(errors.join(" "), "error");
    } else if (added === 0) {
      setStatus("No new supported screenshots were added.");
    }

    renderFiles();
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) throw new Error("Image compression unavailable.");

          let maxDimension = 1200;
          let quality = 0.68;
          let dataUrl = "";

          for (let attempt = 0; attempt < 6; attempt++) {
            const scale = Math.min(
              1,
              maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
            );

            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);

            dataUrl = canvas.toDataURL("image/jpeg", quality);

            if (dataUrl.length <= 400000) break;

            if (quality > 0.48) {
              quality -= 0.08;
            } else {
              maxDimension -= 150;
            }
          }

          URL.revokeObjectURL(objectUrl);

          if (!dataUrl || dataUrl.length > 650000) {
            reject(new Error(
              `${file.name} could not be compressed enough. Use a smaller screenshot.`
            ));
            return;
          }

          resolve({
            timeframe: "",
            mimeType: "image/jpeg",
            dataUrl
          });
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        }
      };

      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(`Could not read ${file.name}. Try another image.`));
      };

      image.src = objectUrl;
    });
  }

  async function analyzeCharts() {
    if (busy) return;

    if (selectedFiles.length === 0) {
      setStatus("Please upload at least one chart screenshot.", "error");
      return;
    }

    const used = new Set();

    for (const item of selectedFiles) {
      if (!item.timeframe) {
        setStatus("Select a timeframe for every screenshot.", "error");
        return;
      }

      if (used.has(item.timeframe)) {
        setStatus(
          "Each screenshot must have a different timeframe. " +
          "Please correct the duplicate selections.",
          "error"
        );
        return;
      }

      used.add(item.timeframe);
    }

    const reportElement = getReportElement();
    reportElement.hidden = false;
    reportElement.replaceChildren(
      createElement("h2", "", "ColloAI Analysis"),
      createElement("p", "", "Preparing screenshots and requesting AI analysis…")
    );

    busy = true;
    const buttons = Array.from(document.querySelectorAll("button"));
    const analyzeButton = buttons.find(button =>
      /analyze my charts/i.test(button.textContent || "")
    );

    if (analyzeButton) {
      analyzeButton.disabled = true;
      analyzeButton.dataset.originalText = analyzeButton.textContent;
      analyzeButton.textContent = "Analyzing…";
    }

    try {
      const charts = [];

      for (const item of selectedFiles) {
        setStatus(`Preparing ${item.timeframe} screenshot…`);

        const compressed = await compressImage(item.file);
        compressed.timeframe = item.timeframe;
        charts.push(compressed);
      }

      charts.sort((a, b) =>
        TIMEFRAMES.findIndex(tf => tf.code === a.timeframe) -
        TIMEFRAMES.findIndex(tf => tf.code === b.timeframe)
      );

      const totalChars = charts.reduce(
        (sum, chart) => sum + chart.dataUrl.length,
        0
      );

      if (totalChars > MAX_TOTAL_IMAGE_CHARS) {
        throw new Error(
          "The screenshots are still too large. Upload fewer or smaller images."
        );
      }

      const payload = {
        symbol: readSymbol(),
        mode: readMode(),
        currentPrice: readPrice(),
        charts
      };

      setStatus("Sending charts to the AI engine…");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          result.error || `Analysis request failed (${response.status}).`
        );
      }

      if (typeof result.report !== "string" || !result.report.trim()) {
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

      setStatus("Analysis completed.", "success");
    } catch (error) {
      reportElement.replaceChildren(
        createElement("h2", "", "Analysis could not be completed"),
        createElement("p", "colloai-error", error.message || "Unknown error.")
      );

      setStatus(
        error.message || "Something went wrong. Please try again.",
        "error"
      );
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
    const reportElement = getReportElement();
    reportElement.replaceChildren();

    reportElement.appendChild(
      createElement("h2", "", "ColloAI Analysis Report")
    );

    reportElement.appendChild(
      createElement(
        "p",
        "colloai-muted",
        `Instrument: ${result.symbol} | Mode: ${result.mode} | ` +
        `Time: ${new Date(result.timestamp || Date.now()).toLocaleString()}`
      )
    );

    const reportText = createElement("pre", "", result.report);
    reportElement.appendChild(reportText);

    const copyButton = createElement("button", "", "Copy report");
    copyButton.type = "button";

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(result.report);
        setStatus("Report copied to clipboard.", "success");
      } catch {
        setStatus(
          "Copy was blocked by your browser. Select and copy the report text.",
          "error"
        );
      }
    });

    const historyButton = createElement("button", "", "View saved reports");
    historyButton.type = "button";
    historyButton.addEventListener("click", showHistory);

    reportElement.append(copyButton, historyButton);
    reportElement.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function saveReport(report) {
    try {
      const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      history.unshift(report);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
    } catch (error) {
      console.warn("Could not save report history:", error.message);
    }
  }

  function showHistory() {
    const reportElement = getReportElement();
    reportElement.replaceChildren(
      createElement("h2", "", "Saved Reports")
    );

    let history = [];

    try {
      history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      history = [];
    }

    if (!history.length) {
      reportElement.appendChild(
        createElement("p", "", "No saved reports on this browser yet.")
      );
      return;
    }

    history.forEach((item, index) => {
      const entry = createElement("div", "colloai-file-card");
      const title = createElement(
        "strong",
        "",
        `${item.symbol} — ${item.mode}`
      );

      const date = createElement(
        "p",
        "colloai-muted",
        new Date(item.timestamp).toLocaleString()
      );

      const open = createElement("button", "", "Open report");
      open.type = "button";

      open.addEventListener("click", () => displayReport(item));

      entry.append(title, date, open);
      reportElement.appendChild(entry);
    });

    reportElement.hidden = false;
  }

  function initialize() {
    addStyles();

    const fileInput = findFileInput();

    if (!fileInput) {
      console.error(
        "ColloAI: no file input found. Check index.html for input[type=file]."
      );

      setStatus(
        "Upload control not found. Please check the file input in index.html.",
        "error"
      );
      return;
    }

    fileInput.multiple = true;
    fileInput.accept = "image/jpeg,image/png,image/webp";

    fileInput.addEventListener("change", event => {
      acceptFiles(event.target.files);

      // Allow selecting the same file again after removing it.
      fileInput.value = "";
    });

    const analyzeButton = Array.from(document.querySelectorAll("button"))
      .find(button => /analyze my charts/i.test(button.textContent || ""));

    if (analyzeButton) {
      analyzeButton.addEventListener("click", event => {
        event.preventDefault();
        analyzeCharts();
      });
    }

    const form = fileInput.closest("form");

    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        analyzeCharts();
      });
    }

    getFileListElement();
    getReportElement();

    setStatus(
      "Upload 1–7 screenshots. Choose a timeframe for each, then analyze."
    );

    console.log("ColloAI upload and analysis interface initialized.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();

