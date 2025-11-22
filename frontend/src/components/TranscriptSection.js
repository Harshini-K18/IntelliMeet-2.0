import React from "react";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { formatTimestamp } from "../utils/formatTimestamp";

function sanitizeSpeaker(raw) {
  if (!raw && raw !== "") return "Unknown";
  try {
    return String(raw).replace(/^\[.*?\]\s*/g, "").trim() || "Unknown";
  } catch {
    return "Unknown";
  }
}

export default function TranscriptSection({
  transcripts = [],
  transcriptContainerRef,
  handleDownloadTranscript,
  handleClearTranscript,
}) {
  // COPY FUNCTION (handles both string and object items)
  async function handleCopyTranscripts() {
    const lines = (Array.isArray(transcripts) ? transcripts : [])
      .map((t) => {
        if (typeof t === "string") {
          return t;
        }
        const speaker = sanitizeSpeaker(t.speaker);
        const time = t.timestamp ? `[${formatTimestamp(t.timestamp)}] ` : "";
        return `${time}${speaker}: ${t.text || ""}`.trim();
      })
      .filter(Boolean);

    const text = lines.join("\n");

    if (!text) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.error("copy transcripts error", err);
    }
  }

  return (
    <div>
      {/* HEADER */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-medium text-light-text dark:text-dark-text">
          Live Transcript
        </h2>

        <div className="flex items-center gap-4">
          <button
            onClick={() => handleDownloadTranscript(transcripts)}
            disabled={!transcripts || transcripts.length === 0}
            className="flex items-center text-blue-600 dark:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 transition duration-200"
          >
            <span className="mr-2">Download Transcript</span>
            <ArrowDownTrayIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* TRANSCRIPT BOX */}
      <div
        ref={transcriptContainerRef}
        className="bg-light-bg dark:bg-dark-bg shadow-inner rounded-lg p-4 max-h-96 overflow-y-auto"
      >
        {!transcripts || transcripts.length === 0 ? (
          <p className="text-light-text dark:text-dark-text text-center">
            No transcripts yet...
          </p>
        ) : (
          transcripts.map((item, index) => {
            // Accept both string lines and object items
            if (typeof item === "string") {
              return (
                <div
                  key={`line-${index}`}
                  className="border-b border-light-accent dark:border-dark-accent last:border-b-0 py-2 px-4 my-2 bg-light-card dark:bg-dark-card text-light-text dark:text-dark-text whitespace-pre-wrap rounded-lg break-words w-fit max-w-[85%] mr-auto"
                >
                  <span>{item}</span>
                </div>
              );
            }

            const key = item.utterance_id || item.id || `t-${index}`;
            const speaker = sanitizeSpeaker(item.speaker);
            const timeStr = item.timestamp ? `[${formatTimestamp(item.timestamp)}] ` : "";

            return (
              <div
                key={key}
                className="border-b border-light-accent dark:border-dark-accent last:border-b-0 py-2 px-4 my-2 bg-light-card dark:bg-dark-card text-light-text dark:text-dark-text whitespace-pre-wrap rounded-lg break-words w-fit max-w-[85%] mr-auto"
                aria-live="polite"
              >
                <span className="font-semibold">
                  {timeStr}
                  {speaker}:{" "}
                </span>
                <span>{item.text || ""}</span>
              </div>
            );
          })
        )}
      </div>

      {/* BUTTON ROW */}
      <div className="flex justify-end gap-3 mt-4">
        {/* COPY BUTTON — BLUE */}
        <button
          onClick={handleCopyTranscripts}
          disabled={!transcripts || transcripts.length === 0}
          className="py-2 px-4 border border-blue-600 text-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 hover:text-white transition duration-200"
        >
          Copy Transcript
        </button>

        {/* CLEAR BUTTON — SAME BLUE STYLE */}
        <button
          onClick={handleClearTranscript}
          disabled={!transcripts || transcripts.length === 0}
          className="py-2 px-4 border border-blue-600 text-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-600 hover:text-white transition duration-200"
        >
          Clear Transcript
        </button>
      </div>
    </div>
  );
}
