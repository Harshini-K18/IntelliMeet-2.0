const axios = require("axios");

let transcripts = [];

function addTranscript(text) {
  transcripts.push(text);
}

function getTranscript() {
  return transcripts.join("\n");
}

const takenotes = (text = "") => {
  if (!text.trim()) return "";
  // Added more common keywords to make this trigger more easily
  const keywords = [
    "task", "job", "assign", "important", "deadline", "focus", "action",
    "priority", "reminder", "complete", "urgent", "follow-up", "deliverable",
    "progress", "update", "review", "meeting", "plan", "goal", "strategy",
    "next step", "milestone", "schedule", "target", "responsibility",
    "assignments", "due", "check", "note", "alert", "watch", "decision",
    "tasklist", "commitment", "objective", "today", "tomorrow", "week",
    "month", "quarter", "idea", "question", "discuss", "remember", "point"
  ];
  const sentences = text.split(/[.?!]\s+/);
  const notes = sentences.filter((s) =>
    keywords.some((k) => s.toLowerCase().includes(k))
  );
  return notes.length ? notes.join(". ").trim() : "";
};

module.exports = {
  addTranscript,
  getTranscript,
  takenotes,
};