// server.js
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");

// task extractor (your util)
const { extractTasks } = require("./utils/taskExtractor");
// jira issue creator
const { createJiraIssueFallback } = require("./utils/jira");

// existing utilities (you already have these)
const { addTranscript, getTranscript, takenotes, generateMomWithOllama } = require("./utils/takeNotes");

const app = express();
const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(bodyParser.json({ limit: "2mb" }));

// Recall API client (unchanged)
const recall = axios.create({
  baseURL: "https://us-west-2.recall.ai/api/v1",
  headers: {
    Authorization: `Token ${process.env.RECALL_API_KEY}`,
    "Content-Type": "application/json",
  },
});

function detectPlatform(url) {
  if (!url || typeof url !== "string") return "Unknown";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("teams.microsoft.com")) return "Microsoft Teams";
  return "Unknown";
}

/* -----------------------\n   Deploy Recall Bot\n------------------------*/
app.post("/deploy-bot", async (req, res) => {
  const { meeting_url } = req.body;
  if (!meeting_url) return res.status(400).json({ error: "Meeting URL is required" });

  const platform = detectPlatform(meeting_url);
  if (platform === "Unknown") return res.status(400).json({ error: "Unsupported meeting platform URL" });

  try {
    const response = await recall.post("/bot", {
      meeting_url,
      bot_name: `IntelliMeet (${platform})`,
      recording_config: {
        transcript: { provider: { meeting_captions: {} } },
        realtime_endpoints: [
          {
            type: "webhook",
            url: process.env.WEBHOOK_URL,
            events: ["transcript.data"],
          },
        ],
      },
    });

    console.log(`✅ ${platform} Bot Deployed:`, response.data.id);
    res.json({
      message: `${platform} bot deployed successfully`,
      bot_id: response.data.id,
    });
  } catch (error) {
    console.error(`❌ Error deploying ${platform} bot:`, error.response?.data || error.message);
    res.status(500).json({ error: `Failed to deploy ${platform} bot: ${error.message}` });
  }
});

/* -----------------------\n   Webhook for realtime transcription\n------------------------*/
app.post("/webhook/transcription", async (req, res) => {
  res.sendStatus(200); // acknowledge quickly
  console.log("--- WEBHOOK RECEIVED ---");
  console.log(JSON.stringify(req.body, null, 2));

  const payload = req.body;
  const transcriptData = payload?.data?.data || {};

  const hasWords = Array.isArray(transcriptData.words) && transcriptData.words.length > 0;
  const hasText = typeof transcriptData.text === "string" && transcriptData.text.trim().length > 0;
  if (!hasWords && !hasText) {
    console.warn("Webhook payload missing words/text - ignoring");
    return;
  }

  const rawSpeaker =
    transcriptData.participant?.name ||
    transcriptData.participant?.display_name ||
    transcriptData.participant?.user_id ||
    transcriptData.speaker ||
    transcriptData.user?.name ||
    transcriptData.owner ||
    "Unknown";

  const speaker = String(rawSpeaker).replace(/^\\[.*?\\]\\s*/g, "").trim() || "Unknown";
  const utterance_id = transcriptData.utterance_id || `auto-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const text = hasWords
    ? transcriptData.words.map((w) => w.text).join(" ").trim()
    : (transcriptData.text || transcriptData.transcript || "").toString().trim();

  const timestamp =
    transcriptData.words?.[0]?.start_timestamp?.relative ||
    transcriptData.start_timestamp?.relative ||
    Date.now();

  const transcript = {
    utterance_id,
    speaker,
    text,
    timestamp,
    is_final: Boolean(transcriptData.is_final),
  };

  console.log("EMITTING transcript ->", JSON.stringify(transcript));
  io.emit("transcript", transcript);

  if (transcript.is_final && transcript.text) {
    try {
      addTranscript({ speaker: transcript.speaker, text: transcript.text, timestamp: transcript.timestamp });

      const fullTranscript = getTranscript();
      const notes = await (async () => {
        try {
          return takenotes(fullTranscript);
        } catch (err) {
          console.error("Error generating notes (takenotes):", err.message || err);
          return null;
        }
      })();

      if (notes) io.emit("notes", { notes });
    } catch (err) {
      console.error("Error storing transcript or generating notes:", err.message || err);
    }
  }
});

/* -----------------------\n   MoM generation endpoint\n------------------------*/
app.post("/generate-mom", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript || transcript.trim() === "") {
    return res.status(400).json({ error: "Transcript is required to generate MoM." });
  }

  try {
    const mom = await generateMomWithOllama(transcript);
    return res.json({ mom });
  } catch (error) {
    console.error("Error generating MoM:", error.message || error);
    return res.status(500).json({ error: "Failed to generate MoM. Please try again later." });
  }
});

/* -----------------------\n   Task extraction endpoint\n------------------------*/
app.post("/extract-tasks", async (req, res) => {
  try {
    const transcript = req.body?.transcript || req.body?.text || "";
    console.log("Received transcript for task extraction (first 400 chars):", (transcript || "").slice(0, 400));

    if (!transcript || transcript.trim().length === 0) {
      console.log("Transcript is missing from the request body");
      return res.status(400).json({ error: "Transcript is required", tasks: [] });
    }

    const tasks = await extractTasks(transcript, { maxTasks: 20 });
    console.log(`Extracted ${Array.isArray(tasks) ? tasks.length : 0} tasks`);
    return res.json({ tasks: Array.isArray(tasks) ? tasks : [] });
  } catch (error) {
    console.error("Error in /extract-tasks:", error?.message || error);
    return res.status(500).json({ error: "Failed to extract tasks", tasks: [] });
  }
});

// Single task -> Jira
app.post("/api/save-to-jira", async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) return res.status(400).json({ error: "Task is required in body" });

    let created;
    if (typeof externalSaveToJira === "function") {
      created = await externalSaveToJira(task);
    } else {
      created = await createJiraIssueFallback(task);
    }

    return res.json({ ok: true, created }); // created.key will hold SCRUM-XX
  } catch (err) {
    console.error("save-to-jira error:", err?.response?.data || err?.message || err);
    return res
      .status(500)
      .json({ ok: false, error: err?.response?.data || err?.message || String(err) });
  }
});

// server.js (replace the existing /api/save-multiple-to-jira handler)
app.post("/api/save-multiple-to-jira", async (req, res) => {
  try {
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ ok: false, error: "tasks array required" });
    }

    const results = [];
    for (let idx = 0; idx < tasks.length; idx++) {
      const t = tasks[idx];
      try {
        let created;
        if (typeof externalSaveToJira === "function") {
          created = await externalSaveToJira(t);
        } else {
          created = await createJiraIssueFallback(t);
        }
        results.push({ ok: true, created, index: idx });
      } catch (err) {
        // collect full error info, but DO NOT throw — continue
        const errInfo = {
          ok: false,
          index: idx,
          message: err?.message || String(err),
          response: err?.response?.data || null,
        };
        console.error("create-jira error for task index", idx, errInfo);
        results.push(errInfo);
      }
    }

    // Always return 200 with per-item results so client can inspect each item
    return res.json({ ok: true, results });
  } catch (err) {
    console.error("save-multiple-to-jira fatal error:", err);
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});


/* -----------------------\n   Health\n------------------------*/
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/* -----------------------\n   Start server\n------------------------*/
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});