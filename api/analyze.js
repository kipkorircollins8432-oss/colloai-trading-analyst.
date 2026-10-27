
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TIMEFRAMES = ["MN", "W1", "D1", "M30", "M15", "M5", "M1"];
const MAX_TOTAL_IMAGE_CHARS = 3_500_000;

const ANALYSIS_PROMPT = `
You are ColloAI, a careful multi-timeframe technical market analyst.

Analyze the supplied chart screenshots as evidence, not as guaranteed predictions.

TRADING METHODS:
1. Market structure, trends, ranges and swing highs/lows.
2. SMC: BOS, CHOCH, liquidity sweeps, order blocks and fair value gaps.
3. ICT: dealing ranges, premium/discount, displacement and liquidity.
4. Support/resistance and supply/demand.
5. Fibonacci retracement and extensions only where swing anchors are identifiable.
6. RSI, MACD, moving averages and other indicators only if visible and readable.
7. Volume Profile only if actual volume-at-price information is visible.
8. Order flow only if actual relevant bid/ask, footprint or delta information is available.
9. Higher-timeframe alignment and lower-timeframe execution evidence.

TIMEFRAME LOGIC:
- Scalping: emphasize M15, M5 and M1, using higher timeframes for context.
- Intraday: emphasize Daily, M30, M15 and lower-timeframe confirmation.
- Swing: emphasize Monthly, Weekly and Daily structure.

For every method, state its findings and whether evidence is available,
partial, unavailable or not applicable.

Never invent live prices, indicator readings, news, volume data, or
broker-specific specifications. Distinguish visual estimates from exact
measurements. Do not claim you checked Investing.com or Barchart unless
their data was actually supplied or retrieved through a configured source.

OUTPUT:
Instrument and selected mode
Data completeness and screenshot readability
Higher-timeframe bias
Lower-timeframe structure
SMC findings
ICT findings
Support/resistance and supply/demand
Fibonacci analysis, if justified
Indicators and volume/order-flow availability
Cross-timeframe agreement and conflicts
Decision: BUY SETUP, SELL SETUP, WAIT, or INSUFFICIENT DATA
Entry zone, stop loss, TP1, TP2 and TP3, only if justified
Invalidation conditions
Risk-to-reward calculations, only when numerical levels permit
Alternative scenario
Risks, uncertainties and missing evidence

Do not force a trade. If evidence is insufficient or contradictory,
choose WAIT or INSUFFICIENT DATA. Explain what confirmation is needed.
Do not invent a win probability or confidence percentage.

End by stating that this is decision support, not a guaranteed signal.
`;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Use POST to submit chart screenshots."
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: "AI is not configured. Add OPENAI_API_KEY in Vercel environment variables."
    });
  }

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({
      error: "Invalid request body."
    });
  }

  const { symbol, mode, currentPrice, charts } = req.body;

  if (
    typeof symbol !== "string" ||
    !/^[A-Z0-9._-]{2,20}$/.test(symbol) ||
    !["Scalping", "Intraday", "Swing"].includes(mode)
  ) {
    return res.status(400).json({
      error: "Invalid instrument or trading mode."
    });
  }

  if (
    currentPrice !== null &&
    currentPrice !== undefined &&
    (!Number.isFinite(currentPrice) || currentPrice <= 0)
  ) {
    return res.status(400).json({
      error: "Current price must be a positive number or null."
    });
  }

  if (!Array.isArray(charts) || charts.length !== TIMEFRAMES.length) {
    return res.status(400).json({
      error: "Submit exactly seven timeframe screenshots."
    });
  }

  const seen = new Set();
  let totalChars = 0;

  for (const chart of charts) {
    if (
      !chart ||
      !TIMEFRAMES.includes(chart.timeframe) ||
      seen.has(chart.timeframe)
    ) {
      return res.status(400).json({
        error: "Invalid or duplicate timeframe."
      });
    }

    seen.add(chart.timeframe);

    if (
      !["image/png", "image/jpeg", "image/webp"].includes(chart.mimeType) ||
      typeof chart.dataUrl !== "string"
    ) {
      return res.status(400).json({
        error: "A screenshot has an unsupported image format."
      });
    }

    const expectedPrefix = `data:${chart.mimeType};base64,`;

    if (!chart.dataUrl.startsWith(expectedPrefix)) {
      return res.status(400).json({
        error: "Invalid screenshot encoding."
      });
    }

    const base64 = chart.dataUrl.slice(expectedPrefix.length);

    if (
      !base64 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ) {
      return res.status(400).json({
        error: "Invalid image data."
      });
    }

    totalChars += chart.dataUrl.length;
  }

  if (totalChars > MAX_TOTAL_IMAGE_CHARS) {
    return res.status(413).json({
      error: "Screenshots are too large. Reduce their dimensions and upload again."
    });
  }

  const content = [
    {
      type: "input_text",
      text:
        ANALYSIS_PROMPT +
        "\nInstrument: " + symbol +
        "\nTrading mode: " + mode +
        "\nUser-supplied current price: " +
        (currentPrice ?? "Not provided") +
        "\n\nAnalyze these screenshots in the supplied timeframe order."
    }
  ];

  for (const chart of charts) {
    content.push({
      type: "input_text",
      text: "The following image is the " + chart.timeframe + " timeframe."
    });

    content.push({
      type: "input_image",
      image_url: chart.dataUrl,
      detail: "high"
    });
  }

  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content
        }
      ],
      max_output_tokens: 3500
    });

    const report = response.output_text;

    if (!report || !report.trim()) {
      return res.status(502).json({
        error: "The AI returned no analysis. Please retry."
      });
    }

    return res.status(200).json({
      report,
      symbol,
      mode,
      analyzedTimeframes: TIMEFRAMES,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("ColloAI analysis request failed:", error.message);

    return res.status(502).json({
      error: "The AI analysis request failed. Check API access, model configuration and billing, then retry."
    });
  }
};
