import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import io from "socket.io-client";
import Navbar from "./components/Navbar";
import InputSection from "./components/InputSection";
import StatusMessage from "./components/StatusMessage";
import TranscriptSection from "./components/TranscriptSection";
import Footer from "./components/Footer";
//import NotesSection from "./components/NotesSection";
import { handleDownloadTranscript } from "./utils/downloadTranscript";
//import SummarySection from "./components/SummarySection";
import MeetingAnalytics from "./components/MeetingAnalytics";
import MeetingSummary from "./components/MeetingSummary"; // Updated import
import TaskExtractor from "./components/TaskExtractor";

const socket = io("http://localhost:3001");

const sanitizeSpeaker = (raw) => {
  if (!raw) return "Unknown";
  return String(raw).replace(/^\[.*?\]\s*/g, "").trim() || "Unknown";
};

const App = () => {
  const [meetingUrl, setMeetingUrl] = useState("");
  const [transcripts, setTranscripts] = useState([]);
  //const [summary, setSummary] = useState("");
  //const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const transcriptContainerRef = useRef(null);

  // Theme management
  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  useEffect(() => {
    const storedDarkMode = localStorage.getItem("darkMode");
    if (storedDarkMode) {
      setDarkMode(JSON.parse(storedDarkMode));
    }
  }, []);

  const toggleDarkMode = () => {
    setDarkMode((prev) => !prev);
  };

  // Handle all real-time socket events
  useEffect(() => {
    // THIS IS THE FIX FOR DISAPPEARING TRANSCRIPTS
    const onTranscript = (incoming) => {
      if (!incoming) return;

      // If incoming is a plain string (rare), convert to object
      let newTranscript = {};
      if (typeof incoming === "string") {
        newTranscript = {
          utterance_id: `ui-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
          speaker: "Unknown",
          text: incoming,
          timestamp: Date.now(),
          is_final: false,
        };
      } else {
        newTranscript = { ...incoming };
      }

      // Ensure utterance_id exists (so we don't drop events)
      if (!newTranscript.utterance_id) {
        newTranscript.utterance_id = `ui-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      }

      // Normalize speaker (strip bracketed timestamps like [00:03] Harshini)
      newTranscript.speaker = sanitizeSpeaker(newTranscript.speaker || newTranscript.participant || "Unknown");

      // Ensure text exists
      newTranscript.text = (newTranscript.text || newTranscript.transcript || newTranscript.chunk || "").toString().trim();

      // If still no text, skip
      if (!newTranscript.text) return;

      setTranscripts((prevTranscripts) => {
        const existingIndex = prevTranscripts.findIndex(
          (t) => t.utterance_id === newTranscript.utterance_id
        );

        if (existingIndex !== -1) {
          // Update an existing transcript line
          const updatedTranscripts = [...prevTranscripts];
          updatedTranscripts[existingIndex] = newTranscript;
          return updatedTranscripts;
        } else {
          // Add a new transcript line
          return [...prevTranscripts, newTranscript];
        }
      });
    };

    socket.on("transcript", onTranscript);
    socket.on("live-transcript", onTranscript);
    socket.on("transcript:update", onTranscript);

    // optional: other socket events (notes/summary) left commented
    /* socket.on("summary", (data) => {
      if (data && data.summary) {
        setSummary(data.summary);
      }
    }); */

    return () => {
      socket.off("transcript", onTranscript);
      socket.off("live-transcript", onTranscript);
      socket.off("transcript:update", onTranscript);
      // socket.off("summary");
    };
  }, []);

  // Auto-scroll to bottom of transcript
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [transcripts]);

  // Deploy bot
  const handleDeployBot = async () => {
    if (!meetingUrl) {
      setStatus("Please enter a valid Meeting URL");
      return;
    }
    setStatus("Deploying bot...");
    try {
      const response = await axios.post("http://localhost:3001/deploy-bot", {
        meeting_url: meetingUrl,
      });
      setStatus(`Bot deployed with ID: ${response.data.bot_id}`);
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message;
      setStatus(`Error deploying bot: ${errorMessage}`);
    }
  };

  // Clear all transcripts
  const handleClearTranscript = () => {
    if (window.confirm("Are you sure you want to clear all transcripts?")) {
      setTranscripts([]);
      // setSummary("");
      //setNotes([]);
    }
  };

  const handleCopyBotId = () => {
    const botId = status.replace("Bot deployed with ID: ", "").trim();
    navigator.clipboard.writeText(botId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1000);
  };

  return (
    <div className="relative min-h-screen bg-light-bg text-light-text dark:bg-dark-bg dark:text-dark-text transition-colors duration-300 font-sans animate-fade-in">
      <Navbar toggleDarkMode={toggleDarkMode} darkMode={darkMode} />

      <div className="max-w-7xl mx-auto py-10 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h1
            className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-light-accent to-light-text dark:from-dark-accent dark:to-white"
            style={{ fontFamily: " sans-serif" }}
          >
            IntelliMeet - Meetings Made Seamless with AI
          </h1>
          <h6 className="text-sm font-normal">
            Supports Google Meet, Zoom, and Microsoft Teams
          </h6>
        </div>

        {/* Input and Status */}
        <div className="bg-light-card dark:bg-dark-card p-6 rounded-lg shadow-md mb-8">
          <InputSection
            meetingUrl={meetingUrl}
            setMeetingUrl={setMeetingUrl}        // <-- pass setter so InputSection can update
            handleDeployBot={handleDeployBot}
          />

          {/* Render StatusMessage so it is detected and works */}
          <StatusMessage
            status={status}
            handleCopyBotId={handleCopyBotId}
            isCopied={isCopied}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Transcripts and Tasks */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            <div className="bg-light-card dark:bg-dark-card p-6 rounded-lg shadow-md">
              <TranscriptSection
                transcripts={transcripts}
                transcriptContainerRef={transcriptContainerRef}
                handleDownloadTranscript={() =>
                  handleDownloadTranscript(transcripts)
                }
                handleClearTranscript={handleClearTranscript}
              />
            </div>
           {/* Task Extractor */}
            <div className="bg-light-card dark:bg-dark-card p-6 rounded-lg shadow-md">
              <TaskExtractor transcripts={transcripts} />
            </div>
          </div>

          {/* Right Column: Summary, MoM, Analytics */}
          <div className="lg:col-span-1 flex flex-col gap-8">
           {/* Summary */}
            {/*
            <div className="bg-light-card dark:bg-dark-card p-6 rounded-lg shadow-md">
              <SummarySection summary={summary} />
            </div>
            */}

            {/* Meeting Analytics */}
            <div className="bg-light-card dark:bg-dark-card p-6 rounded-lg shadow-md">
              <MeetingAnalytics transcript={transcripts} />
            </div>

            {/* MoM Section - Always visible at the bottom right */}
            <div className="bg-light-card dark:bg-dark-card p-6 rounded-lg shadow-md">
              <MeetingSummary /> {/* Updated component */}
            </div>
          </div>
        </div>

        {/* Task extractor UI (safe, non-intrusive) */}
        {/* <TaskExtractor /> */}
        
      </div>

      <Footer />
    </div>
  );
};

export default App;
