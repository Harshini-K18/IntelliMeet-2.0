import React, { useState } from "react";

const MeetingSummary = () => {
  const [transcript, setTranscript] = useState("");
  const [mom, setMom] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGenerateSummary = async () => {
    if (!transcript.trim()) {
      alert("Please enter a transcript.");
      return;
    }

    setLoading(true);
    setMom(""); // Clear previous MoM immediately so UI feels responsive
    try {
      const response = await fetch("http://localhost:3001/generate-mom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Failed to generate the meeting summary.");
      }

      const data = await response.json();
      const raw = data.mom || "Failed to generate the meeting summary.";
      // Transform raw text into highlighted HTML
      const html = transformMomToHtml(raw);
      setMom(html);
    } catch (error) {
      console.error("Error generating meeting summary:", error.message);
      setMom(`<p><strong>Error:</strong> Error generating the meeting summary. Please try again later.</p>`);
    } finally {
      setLoading(false);
    }
  };

  // Conservative transformation of MoM text -> HTML with highlighted headings.
  const transformMomToHtml = (text) => {
    if (!text) return "";

    let out = text;

    // 1) Ensure speaker lines like "[0:00] Harshini K: ..." are preserved and highlighted
    // Wrap speaker name with <strong> but keep the rest unchanged.
    out = out.replace(
      /(\[?\d{1,2}:\d{2}\]?\s*)([A-Za-z0-9 ._-]{2,40}):/g,
      (m, time, speaker) => `${time}<strong>${speaker}:</strong>`
    );

    // 2) Bold standard labels (Date:, Time:, Attendees:, Topic:, Key Points:, Decisions Made:, Action Items:)
    out = out.replace(/(^|\n)(\s*)(Date:|Time:|Attendees:|Topic:|Key Points:|Decisions Made:|Action Items:)/gi, (m, nl, sp, label) => `${nl}${sp}<strong>${label}</strong>`);

    // 3) Bold Markdown-style headings (lines starting with **Heading** or Heading:)
    out = out.replace(/^\s*\*\*(.+?)\*\*/gm, (m, h) => `\n<strong>${h.trim()}</strong>\n`);
    out = out.replace(/^(.+?):\s*$/gm, (m, h) => `<strong>${h.trim()}:</strong>\n`); // lines that are just "Heading:"

    // 4) Convert newlines to <br/> to preserve spacing
    // But first compress multiple newlines to paragraph-like spacing
    out = out.replace(/\n{3,}/g, "\n\n");
    out = out.split("\n").map(line => line === "" ? "<br/>" : line).join("<br/>");

    return out;
  };

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-semibold mb-4 text-center">Generate Meeting Summary</h2>
      <textarea
        className="w-full p-4 border rounded-md mb-4"
        rows="6"
        placeholder="Paste the meeting transcript here..."
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
      ></textarea>
      <button
        onClick={handleGenerateSummary}
        className="bg-teal-500 text-white px-4 py-2 rounded-md hover:bg-teal-600 transition disabled:opacity-60"
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate Summary"}
      </button>

      {mom && (
        <div className="bg-gray-100 p-4 rounded-md shadow-md mt-4 whitespace-pre-wrap">
          <h3 className="text-xl font-bold mb-2">Minutes of Meeting:</h3>
          <div dangerouslySetInnerHTML={{ __html: mom }} />
        </div>
      )}
    </div>
  );
};

export default MeetingSummary;
