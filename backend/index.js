// server.js (replace your current server file with this — no other files modified)

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { Server } = require("socket.io");
const cors = require("cors");
const {
  addTranscript,
  getTranscript,
  takenotes,
} = require("./utils/takeNotes");

const app = express();
const server = require("http").createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000" },
});

app.use(express.json());
app.use(cors());

// Recall API instance
const recall = axios.create({
  baseURL: "https://us-west-2.recall.ai/api/v1",
  headers: {
    Authorization: `Token ${process.env.RECALL_API_KEY}`,
    "Content-Type": "application/json",
  },
});

// Identify meeting platform automatically
function detectPlatform(url) {
  if (!url || typeof url !== "string") return "Unknown";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("teams.microsoft.com")) return "Microsoft Teams";
  return "Unknown";
}

// Deploy Recall Bot
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

// Webhook to receive real-time transcription payloads from Recall
app.post("/webhook/transcription", async (req, res) => {
  // Acknowledge quickly
  res.sendStatus(200);

  console.log("--- WEBHOOK RECEIVED ---");
  console.log(JSON.stringify(req.body, null, 2));

  const payload = req.body;
  const transcriptData = payload?.data?.data || {};

  // Make sure payload contains the expected structure
  if (!transcriptData.words || !Array.isArray(transcriptData.words)) {
    console.warn("Webhook payload missing words array - ignoring");
    return;
  }

  const transcript = {
    utterance_id: transcriptData.utterance_id || `auto-${Date.now()}`,
    speaker: transcriptData.participant?.name || "Unknown",
    text: transcriptData.words.map((w) => w.text).join(" ").trim(),
    timestamp:
      transcriptData.words[0]?.start_timestamp?.relative || Date.now(),
    is_final: Boolean(transcriptData.is_final),
  };

  // Emit the real-time transcript to the frontend
  io.emit("transcript", transcript);

  // If this is a final transcript segment, store it and update insights
  if (transcript.is_final && transcript.text) {
    addTranscript(transcript.text);

    // Generate and emit notes
    (async () => {
      try {
        const fullTranscript = getTranscript();
        const notes = takenotes(fullTranscript);
        io.emit("notes", { notes });
      } catch (err) {
        console.error("Error generating insights:", err.message);
      }
    })();
  }
});

// Health check
app.get("/health", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});