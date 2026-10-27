
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const TIMEFRAMES = ["MN", "W1", "D1", "M30", "M15", "M5", "M1"];

const ANALYSIS_PROMPT = `
You are ColloAI, a professional technical market analyst.

Analyze the user's uploaded trading-chart screenshots using only
information genuinely visible in those screenshots.

The user may upload any ONE or more of these timeframes:
MN, W1, D1, M30, M15, M5, M1.

Analyze only the timeframes supplied. Never claim to have seen a
timeframe that was not uploaded.

Examine visible price action, market structure, BOS, CHOCH, liquidity,
support and resistance, supply and demand, fair value gaps, order
blocks, Fibonacci levels, candlestick patterns, and indicators when
they are visible and readable.

Discuss volume profile, order flow, and other tools only when their
relevant data is actually visible. Do not invent missing data,
indicator values, prices, news, or market conditions.

Respect the selected trading style:
- Scalping: prioritize lower timeframes and precise risk management.
- Intraday: consider intraday structure and relevant higher-timeframe
  context when supplied.
- Swing: prioritize higher-timeframe structure when supplied.

Use higher timeframes for context when available and lower timeframes
for execution when available. If only one timeframe is supplied,
clearly state that the analysis has limited context.

Return a useful report with these headings:

1. MARKET OVERVIEW
2. TIMEFRAMES RECEIVED
3. MARKET STRUCTURE
4. KEY SUPPORT AND RESISTANCE
5. LIQUIDITY AND SMC/ICT OBSERVATIONS
6. INDICATORS AND VOLUME
7. BUY SCENARIO
8. SELL SCENARIO
9. TRADE SETUP, IF JUSTIFIED
10. INVALIDATION AND RISK MANAGEMENT
11. FINAL BIAS AND CONFIDENCE

For any proposed trade, specify direction, entry zone, stop loss,
and take-profit targets only when the screenshot provides enough
evidence to justify them. Otherwise write "No reliable entry yet"
and explain what confirmation is needed.

Never guarantee profits. Do not pretend to know the future.
Explain uncertainty and avoid encouraging excessive leverage.
The user makes the final trading decision.

Symbol: provided by the user.
Trading style: provided by the user.
Current price: use only if supplied by the user.
`;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed. Send a POST request.",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error:
        "The server is missing OPENAI_API_KEY. Add it in Vercel Environment Variables.",
    });
  }

  try {
    const body = req.body || {};
    const symbol =
      typeof body.symbol === "string" && body.symbol.trim()
        ? body.symbol.trim().slice(0, 30)
        : "Unknown symbol";

    const mode =
      typeof body.mode === "string" && body.mode.trim()
        ? body.mode.trim().slice(0, 50)
        : "Intraday";

    const currentPrice = body.currentPrice;
    const charts = body.charts;

    if (
      currentPrice !== null &&
      currentPrice !== undefined &&
      currentPrice !== "" &&
      (!Number.isFinite(Number(currentPrice)) ||
        Number(currentPrice) <= 0)
    ) {
      return res.status(400).json({
        error: "Current price must be a positive number or empty.",
      });
    }

    if (
      !Array.isArray(charts) ||
      charts.length < 1 ||
      charts.length > TIMEFRAMES.length
    ) {
      return res.status(400).json({
        error: "Upload between 1 and 7 chart screenshots.",
      });
    }

    const seenTimeframes = new Set();
    const imageInputs = [];

    for (const chart of charts) {
      if (!chart || typeof chart !== "object") {
        return res.status(400).json({
          error: "One of the uploaded chart entries is invalid.",
        });
      }

      const timeframe = String(chart.timeframe || "").toUpperCase();

      if (!TIMEFRAMES.includes(timeframe)) {
        return res.status(400).json({
          error: `Invalid timeframe: ${timeframe || "missing"}.`,
        });
      }

      if (seenTimeframes.has(timeframe)) {
        return res.status(400).json({
          error: `You uploaded the ${timeframe} timeframe more than once.`,
        });
      }

      seenTimeframes.add(timeframe);

      if (
        typeof chart.image !== "string" ||
        !chart.image.startsWith("data:image/")
      ) {
        return res.status(400).json({
          error: `The ${timeframe} screenshot is missing or invalid.`,
        });
      }

      const match = chart.image.match(
        /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/
      );

      if (!match) {
        return res.status(400).json({
          error: `The ${timeframe} image must be JPEG, PNG, or WebP.`,
        });
      }

      const imageBytes = Buffer.from(match[2], "base64");

      if (imageBytes.length === 0 || imageBytes.length > 2_000_000) {
        return res.status(400).json({
          error: `The ${timeframe} screenshot must be under 2 MB after compression.`,
        });
      }

      const mimeType =
        match[1] === "jpg" ? "jpeg" : match[1];

      imageInputs.push({
        type: "input_text",
        text: `Screenshot timeframe: ${timeframe}`,
      });

      imageInputs.push({
        type: "input_image",
        image_url: `data:image/${mimeType};base64,${match[2]}`,
        detail: "high",
      });
    }

    const priceText =
      currentPrice !== null &&
      currentPrice !== undefined &&
      currentPrice !== ""
        ? String(Number(currentPrice))
        : "Not supplied";

    const userContent = [
      {
        type: "input_text",
        text:
          `Analyze symbol: ${symbol}\n` +
          `Trading style: ${mode}\n` +
          `User-supplied current price: ${priceText}\n` +
          `Number of screenshots: ${charts.length}\n` +
          `Analyze only the screenshots included in this request.`,
      },
      ...imageInputs,
    ];

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      instructions: ANALYSIS_PROMPT,
      input: [
        {
          role: "user",
          content: userContent,
        },
      ],
      max_output_tokens: 2500,
    });

    const report = response.output_text;

    if (!report || !report.trim()) {
      return res.status(502).json({
        error: "The AI returned an empty report. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      symbol,
      mode,
      analyzedTimeframes: charts.map((chart) =>
        String(chart.timeframe).toUpperCase()
      ),
      report: report.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("ColloAI analysis error:", error);

    if (error.status === 401) {
      return res.status(502).json({
        error:
          "OpenAI rejected the API key. Check OPENAI_API_KEY in Vercel.",
      });
    }

    if (error.status === 429) {
      return res.status(502).json({
        error:
          "The AI API quota may be exhausted or rate-limited. Check your OpenAI API billing and usage.",
      });
    }

    if (error.status === 400) {
      return res.status(502).json({
        error:
          "The AI API rejected the request. Check the screenshot format and API configuration.",
      });
    }

    return res.status(500).json({
      error:
        "The analysis server encountered an error. Check the Vercel Function Logs for details.",
    });
  }
};

