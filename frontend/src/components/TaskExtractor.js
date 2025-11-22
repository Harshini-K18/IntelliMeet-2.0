// src/components/TaskExtractor.js
import React, { useState } from "react";
import axios from "axios";

const TaskExtractor = () => {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [pastedTranscript, setPastedTranscript] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  const extractTasks = async () => {
    if (!pastedTranscript.trim()) {
      setTasks([]);
      return;
    }

    setIsExtracting(true);
    setError(null);

    try {
      const response = await axios.post("http://localhost:3001/extract-tasks", {
        transcript: pastedTranscript,
      });

      let extractedTasks = [];

      if (response.data && response.data.tasks) {
        if (Array.isArray(response.data.tasks)) {
          extractedTasks = response.data.tasks;
        } else if (typeof response.data.tasks === "string") {
          try {
            const parsedTasks = JSON.parse(response.data.tasks);
            if (Array.isArray(parsedTasks)) extractedTasks = parsedTasks;
          } catch (err) {
            console.error("Parse error:", err);
            setError("Failed to parse task output from server.");
          }
        }
      }

      setTasks(extractedTasks);
    } catch (err) {
      console.error(err);
      setError("Failed to extract tasks. Check backend log.");
    }

    setIsExtracting(false);
  };

  const copyToClipboard = () => {
    const taskText = tasks
      .map(
        (task) =>
          `Task: ${task.task}\nOwner: ${
            task.assigned_to || task.owner || "Unassigned"
          }\nDeadline: ${task.deadline || "Not set"}\nSource: ${
            task.original_line || ""
          }\n`
      )
      .join("\n");

    navigator.clipboard.writeText(taskText);
  };

  const emailTasks = () => {
    const subject = "Meeting Tasks";
    const body = tasks
      .map(
        (task) =>
          `Task: ${task.task}%0AOwner: ${
            task.assigned_to || task.owner || "Unassigned"
          }%0ADeadline: ${
            task.deadline || "Not set"
          }%0AOriginal: ${encodeURIComponent(task.original_line || "")}`
      )
      .join("%0A%0A");

    window.location.href = `mailto:?subject=${encodeURIComponent(
      subject
    )}&body=${body}`;
  };

const saveToJira = async (taskOrTasks) => {
  const isBatch = Array.isArray(taskOrTasks);
  const endpoint = isBatch
    ? "http://localhost:3001/api/save-multiple-to-jira"
    : "http://localhost:3001/api/save-to-jira";

  const payload = isBatch ? { tasks: taskOrTasks } : { task: taskOrTasks };

  try {
    const res = await axios.post(endpoint, payload, { timeout: 30000 });

    // Handle bulk endpoint
    if (isBatch) {
      const results = res.data?.results || res.data?.results || [];
      // build success & failure lists
      const successes = results.filter(r => r.ok && r.created?.key).map(r => r.created.key);
      const failures = results.filter(r => !r.ok);

      let msgParts = [];
      if (successes.length) msgParts.push(`Created: ${successes.join(", ")}`);
      if (failures.length) {
        msgParts.push(`Failed: ${failures.map(f => `#${f.index}:${f.message || (f.response && JSON.stringify(f.response)) || "unknown"}`).join("; ")}`);
      }
      alert(msgParts.join("\n"));
    } else {
      const created = res.data?.created || res.data?.jira || res.data;
      const key = created?.key || created?.issueKey || null;
      if (key) {
        alert(`Saved to Jira as ${key}`);
      } else {
        // if backend returned an error shape but HTTP 200
        if (res.data?.ok === false) {
          alert(`Save failed: ${JSON.stringify(res.data)}`);
        } else {
          alert("Saved to Jira (no issue key returned). Check server logs.");
        }
      }
    }
  } catch (err) {
    console.error("saveToJira error:", err);
    // show helpful message with server response if available
    const serverData = err.response?.data;
    const status = err.response?.status;
    const serverMsg = serverData ? (serverData.error || JSON.stringify(serverData)) : err.message;
    alert(`Failed to save to Jira. ${status ? `HTTP ${status}: ` : ""}${serverMsg}`);
  }
};


  return (
    <div className="p-4 border rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">Task Extractor</h2>

      {/* TEXTAREA */}
      <textarea
        className="w-full p-3 border rounded mb-3"
        rows="10"
        placeholder="Paste transcript here..."
        value={pastedTranscript}
        onChange={(e) => setPastedTranscript(e.target.value)}
      ></textarea>

      <div className="flex gap-3 mb-4">
        <button
          onClick={extractTasks}
          className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
          disabled={isExtracting || !pastedTranscript.trim()}
        >
          {isExtracting ? "Extracting..." : "Extract Tasks"}
        </button>

        <button
          onClick={() => {
            setPastedTranscript("");
            setTasks([]);
          }}
          className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600"
        >
          Clear
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      {/* TASKS */}
      <div className="space-y-4">
        {tasks.map((task, i) => (
          <div
            key={task.task_id || i}
            className="p-4 border rounded-lg bg-gray-50"
          >
            <p className="font-semibold">{task.task}</p>
            <p className="text-sm text-gray-600">
              <strong>Owner:</strong>{" "}
              {task.assigned_to || task.owner || "Unassigned"}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Deadline:</strong> {task.deadline || "Not set"}
            </p>
            {task.original_line && (
              <p className="text-sm text-gray-500 italic">
                Source: "{task.original_line}"
              </p>
            )}

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => saveToJira(task)}
                className="bg-blue-500 text-white py-1 px-3 rounded"
              >
                Save to Jira
              </button>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    JSON.stringify(task, null, 2)
                  )
                }
                className="bg-gray-500 text-white py-1 px-3 rounded"
              >
                Copy
              </button>
            </div>
          </div>
        ))}
      </div>

      {tasks.length > 0 && (
        <div className="mt-5 pt-4 border-t flex gap-2">
          <button
            onClick={() => saveToJira(tasks)}
            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
          >
            Save All to Jira
          </button>
          <button
            onClick={emailTasks}
            className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600"
          >
            Email Tasks
          </button>
          <button
            onClick={copyToClipboard}
            className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600"
          >
            Copy Tasks
          </button>
        </div>
      )}
    </div>
  );
};

export default TaskExtractor;