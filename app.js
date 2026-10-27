
const TIMEFRAMES = [
  { id: "MN", name: "Monthly" },
  { id: "W1", name: "Weekly" },
  { id: "D1", name: "Daily" },
  { id: "M30", name: "30 Minutes" },
  { id: "M15", name: "15 Minutes" },
  { id: "M5", name: "5 Minutes" },
  { id: "M1", name: "1 Minute" }
];

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const selectedCharts = new Map();

const uploadGrid = document.getElementById("uploadGrid");
const fileStatus = document.getElementById("fileStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const results = document.getElementById("results");
const report = document.getElementById("report");

function createUploadCards() {
  uploadGrid.replaceChildren();

  for (const timeframe of TIMEFRAMES) {
    const card = document.createElement("div");
    card.className = "upload-card";

    const title = document.createElement("strong");
    title.textContent = timeframe.name;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp";
    input.setAttribute("aria-label", timeframe.name + " chart screenshot");

    const preview = document.createElement("img");
    preview.alt = timeframe.name + " chart preview";
    preview.hidden = true;

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];

      if (!file) {
        selectedCharts.delete(timeframe.id);
        preview.hidden = true;
        updateFileStatus();
        return;
      }

      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        alert("Please select a PNG, JPEG or WebP image.");
        input.value = "";
        selectedCharts.delete(timeframe.id);
        preview.hidden = true;
        updateFileStatus();
        return;
      }

      if (file.size > MAX_IMAGE_SIZE) {
        alert("Each screenshot must be no larger than 8 MB.");
        input.value = "";
        selectedCharts.delete(timeframe.id);
        preview.hidden = true;
        updateFileStatus();
        return;
      }

      try {
        const dataUrl = await readImage(file);
        selectedCharts.set(timeframe.id, {
          timeframe: timeframe.id,
          name: file.name,
          mimeType: file.type,
          dataUrl
        });

        preview.src = dataUrl;
        preview.hidden = false;
        updateFileStatus();
      } catch {
        alert("Could not read this image. Please try another screenshot.");
        input.value = "";
        selectedCharts.delete(timeframe.id);
        preview.hidden = true;
        updateFileStatus();
      }
    });

    card.append(title, input, preview);
    uploadGrid.append(card);
  }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Invalid image data"));
      }
    };

    reader.onerror = () => reject(new Error("Image read failed"));
    reader.readAsDataURL(file);
  });
}

function updateFileStatus() {
  const count = selectedCharts.size;
  const missing = TIMEFRAMES
    .filter(item => !selectedCharts.has(item.id))
    .map(item => item.name);

  fileStatus.textContent =
    `${count} of ${TIMEFRAMES.length} screenshots selected. ` +
    (missing.length ? `Missing: ${missing.join(", ")}.` : "All timeframes uploaded.");
}

function validateResponse(data) {
  if (!data || typeof data !== "object" || typeof data.report !== "string") {
    throw new Error("The analysis server returned an invalid response.");
  }

  return data.report;
}

async function analyzeCharts() {
  if (selectedCharts.size !== TIMEFRAMES.length) {
    const missing = TIMEFRAMES
      .filter(item => !selectedCharts.has(item.id))
      .map(item => item.name);

    alert("Please upload all seven screenshots first. Missing: " + missing.join(", "));
    return;
  }

  const symbol = document.getElementById("symbol").value;
  const mode = document.getElementById("mode").value;
  const priceInput = document.getElementById("currentPrice").value;
  const currentPrice = priceInput ? Number(priceInput) : null;

  if (currentPrice !== null &&
      (!Number.isFinite(currentPrice) || currentPrice <= 0)) {
    alert("Enter a valid positive market price or leave the field empty.");
    return;
  }

  const charts = TIMEFRAMES.map(item => selectedCharts.get(item.id));

  results.hidden = false;
  report.textContent = "Preparing your screenshots...";
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing...";

  try {
    report.textContent =
      "Sending charts to the secure analysis service. Please wait...";

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        mode,
        currentPrice,
        charts
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Analysis failed (${response.status}).`);
    }

    report.textContent = validateResponse(data);

    try {
      const history = JSON.parse(
        localStorage.getItem("colloai-history") || "[]"
      );

      history.unshift({
        date: new Date().toISOString(),
        symbol,
        mode,
        report: data.report
      });

      localStorage.setItem(
        "colloai-history",
        JSON.stringify(history.slice(0, 10))
      );
    } catch {
      // Analysis still works if browser storage is unavailable.
    }
  } catch (error) {
    report.textContent =
      "Analysis could not be completed.\n\n" +
      (error.message || "Please try again later.") +
      "\n\nCheck that the backend is deployed and its AI API is configured.";
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Analyze my charts";
  }
}

analyzeBtn.addEventListener("click", analyzeCharts);
createUploadCards();
updateFileStatus();
