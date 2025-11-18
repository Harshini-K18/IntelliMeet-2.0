// server.js (combined: Recall bot + webhook + socket.io + /generate-mom endpoint)
require("dotenv").config();

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");

// add this require near other requires
const { extractTasks } = require("./utils/taskExtractor");

// utilities from your existing codebase:
// - addTranscript(text): saves transcript text
// - getTranscript(): returns full concatenated transcript
// - takenotes(fullTranscript): returns notes/insights (existing)
const { addTranscript, getTranscript, takenotes } = require("./utils/takeNotes");

// Ollama MoM generator (new robust handler you already added)
const { generateMomWithOllama } = require("./utils/takeNotes");

const app = express();
const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000" },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(bodyParser.json({ limit: "2mb" }));

// Recall API instance (used to deploy bots)
const recall = axios.create({
  baseURL: "https://us-west-2.recall.ai/api/v1",
  headers: {
    Authorization: `Token ${process.env.RECALL_API_KEY}`,
    "Content-Type": "application/json",
  },
});

// Utility: detect meeting platform
function detectPlatform(url) {
  if (!url || typeof url !== "string") return "Unknown";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("teams.microsoft.com")) return "Microsoft Teams";
  return "Unknown";
}

/* -----------------------
   Deploy Recall Bot
   POST /deploy-bot
   body: { meeting_url }
------------------------*/
app.post("/deploy-bot", async (req, res) => {
  const { meeting_url } = req.body;
  if (!meeting_url) {
    return res.status(400).json({ error: "Meeting URL is required" });
  }

  const platform = detectPlatform(meeting_url);
  if (platform === "Unknown") {
    return res
      .status(400)
      .json({ error: "Unsupported meeting platform URL" });
  }

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
    console.error(
      `❌ Error deploying ${platform} bot:`,
      error.response?.data || error.message
    );
    res
      .status(500)
      .json({ error: `Failed to deploy ${platform} bot: ${error.message}` });
  }
});

/* -----------------------
   Webhook for realtime transcription
   POST /webhook/transcription
   (Recall will POST here)
------------------------*/
app.post("/webhook/transcription", async (req, res) => {
  // Acknowledge immediately to recall
  res.sendStatus(200);

  console.log("--- WEBHOOK RECEIVED ---");
  // Log might be verbose — keep for debug, remove later
  console.log(JSON.stringify(req.body, null, 2));

  const payload = req.body;
  const transcriptData = payload?.data?.data || {};

  // Basic validation
  if (!transcriptData.words || !Array.isArray(transcriptData.words)) {
    console.warn("Webhook payload missing words array - ignoring");
    return;
  }

  // Build a normalized transcript object
  const transcript = {
    utterance_id: transcriptData.utterance_id || `auto-${Date.now()}`,
    speaker: transcriptData.participant?.name || "Unknown",
    text: transcriptData.words.map((w) => w.text).join(" ").trim(),
    timestamp:
      transcriptData.words[0]?.start_timestamp?.relative || Date.now(),
    is_final: Boolean(transcriptData.is_final),
  };

  // Emit real-time transcript to connected frontends
  io.emit("transcript", transcript);

  // When final segment arrives, persist and update insights/notes
  if (transcript.is_final && transcript.text) {
    try {
      addTranscript(transcript.text);

      // Generate updated notes/insights from the full transcript and emit
      const fullTranscript = getTranscript(); // your existing aggregator
      const notes = await (async () => {
        try {
          // If your takenotes is synchronous, it will return value directly; if async, await it.
          const result = takenotes(fullTranscript);
          return result;
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

/* -----------------------
   MoM generation endpoint
   POST /generate-mom
   body: { transcript: "<full transcript text>" }
   Returns: { mom: "<generated mom text>" }
------------------------*/
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

app.post("/extract-tasks", async (req, res) => {
  try {
    const { transcript } = req.body;
    console.log("Received transcript for task extraction:", transcript); 
    if (!transcript) {
      console.log("Transcript is missing from the request body"); 
      return res.status(400).json({ error: "Transcript is required" });
    }
    const tasks = await extractTasks(transcript);
    console.log("Extracted tasks:", tasks); 
    res.json({ tasks });
  } catch (error) {
    console.error("Error in /extract-tasks:", error);
    res.status(500).json({ error: "Failed to extract tasks" });
  }
});

// --- BEGIN: Trello + Asana save endpoints ---
// Requires: axios already imported at top of server.js
// Make sure .env contains TRELLO_KEY, TRELLO_TOKEN, TRELLO_LIST_ID, ASANA_PAT, ASANA_PROJECT_ID (optional), ASANA_WORKSPACE_ID (optional)

app.post("/api/save-to-trello", async (req, res) => {
  try {
    const { tasks = [], title = "Meeting tasks" } = req.body;
    const key = process.env.TRELLO_KEY;
    const token = process.env.TRELLO_TOKEN;
    const listId = process.env.TRELLO_LIST_ID; // required

    if (!key || !token || !listId) {
      return res.status(500).json({ error: "Trello credentials or list ID not configured on server." });
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: "No tasks provided" });
    }

    const created = [];
    for (const t of tasks) {
      const name = (t.task || "").toString().slice(0, 100) || title;
      const descLines = [];
      if (t.task) descLines.push(t.task);
      if (t.assigned_to) descLines.push(`Owner: ${t.assigned_to}`);
      if (t.deadline) descLines.push(`Deadline: ${t.deadline}`);
      const desc = descLines.join("\n\n");

      const url = `https://api.trello.com/1/cards`;
      // Trello card creation uses query params
      const resp = await axios.post(url, null, {
        params: {
          key,
          token,
          idList: listId,
          name,
          desc,
        },
        timeout: 15000,
      });

      created.push({ id: resp.data.id, url: resp.data.url, name: resp.data.name });
    }

    return res.json({ message: `Created ${created.length} Trello card(s)`, created });
  } catch (err) {
    console.error("Trello save error:", err?.response?.data || err.message || err);
    return res.status(500).json({ error: err?.response?.data || err.message || "Trello save failed" });
  }
});

app.post("/api/save-to-asana", async (req, res) => {
  try {
    const { tasks = [], title = "Meeting tasks" } = req.body;
    const pat = process.env.ASANA_PAT;
    const projectId = process.env.ASANA_PROJECT_ID; // optional but recommended
    const workspaceId = process.env.ASANA_WORKSPACE_ID; // optional fallback

    if (!pat) {
      return res.status(500).json({ error: "Asana PAT not configured on server." });
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: "No tasks provided" });
    }

    const created = [];
    for (const t of tasks) {
      const name = (t.task || title).toString().slice(0, 255);
      const notesParts = [];
      if (t.task) notesParts.push(t.task);
      if (t.assigned_to) notesParts.push(`Owner: ${t.assigned_to}`);
      if (t.deadline) notesParts.push(`Deadline: ${t.deadline}`);
      const notes = notesParts.join("\n\n");

      const payload = { data: { name, notes } };
      if (projectId) payload.data.projects = [projectId];
      if (workspaceId && !projectId) payload.data.workspace = workspaceId; // Asana often requires workspace when not using project

      const resp = await axios.post("https://app.asana.com/api/1.0/tasks", payload, {
        headers: {
          Authorization: `Bearer ${pat}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      });

      // resp.data has the created task object in resp.data.data
      created.push({ id: resp.data?.data?.gid || null, name: resp.data?.data?.name || name, resource: resp.data?.data || resp.data });
    }

    return res.json({ message: `Created ${created.length} Asana task(s)`, created });
  } catch (err) {
    console.error("Asana save error:", err?.response?.data || err.message || err);
    return res.status(500).json({ error: err?.response?.data || err.message || "Asana save failed" });
  }
});
// --- END: Trello + Asana save endpoints ---


/* -----------------------
   Health check
------------------------*/
app.get("/health", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

/* -----------------------
   Start server
------------------------*/
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
