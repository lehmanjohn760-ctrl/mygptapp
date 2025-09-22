const recordButton = document.getElementById("recordButton");
const stopButton = document.getElementById("stopButton");
const recordingStatus = document.getElementById("recordingStatus");
const noteMetaForm = document.getElementById("noteMetaForm");
const noteTitleInput = document.getElementById("noteTitle");
const noteDescriptionInput = document.getElementById("noteDescription");
const discardNoteButton = document.getElementById("discardNote");
const voiceNotesList = document.getElementById("voiceNotesList");
const voiceNoteTemplate = document.getElementById("voiceNoteTemplate");

const taskForm = document.getElementById("taskForm");
const taskTitleInput = document.getElementById("taskTitle");
const taskDetailsInput = document.getElementById("taskDetails");
const taskPriorityInput = document.getElementById("taskPriority");
const taskList = document.getElementById("taskList");
const taskTemplate = document.getElementById("taskTemplate");

const VOICE_NOTES_KEY = "daily-voice-notes";
const TASKS_KEY = "daily-task-list";
const supportsRecording =
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices &&
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined";

let mediaRecorder;
let audioChunks = [];
let pendingRecording = null;
let currentStream;

const voiceNotes = loadState(VOICE_NOTES_KEY, []);
const tasks = loadState(TASKS_KEY, []);

renderVoiceNotes();
renderTasks();

if (!supportsRecording) {
  recordButton.disabled = true;
  stopButton.disabled = true;
  recordingStatus.textContent =
    "Voice recording is not supported in this browser. Try using the latest version of Chrome, Edge, or Firefox.";
}

noteMetaForm.hidden = true;
discardNoteButton.disabled = true;

recordButton.addEventListener("click", startRecording);
stopButton.addEventListener("click", stopRecording);
noteMetaForm.addEventListener("submit", savePendingRecording);
discardNoteButton.addEventListener("click", discardPendingRecording);
taskForm.addEventListener("submit", handleTaskSubmit);

function clone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : clone(fallback);
  } catch (error) {
    console.warn(`Failed to load ${key}`, error);
    return clone(fallback);
  }
}

function persistState(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Unable to save ${key}`, error);
  }
}

async function startRecording() {
  if (!supportsRecording) {
    recordingStatus.textContent =
      "Voice recording is unavailable. Please use a compatible browser.";
    return;
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    return;
  }

  recordingStatus.textContent = "Requesting microphone access...";
  recordButton.disabled = true;
  stopButton.disabled = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    currentStream = stream;

    const options = {};
    const mimeType = getSupportedMimeType();
    if (mimeType) {
      options.mimeType = mimeType;
    }

    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", handleRecordingStop);

    mediaRecorder.start();
    stopButton.disabled = false;
    recordingStatus.textContent = "Recording in progress...";
    noteMetaForm.hidden = true;
    discardNoteButton.disabled = true;
  } catch (error) {
    handleRecordingError(error);
  } finally {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
      recordButton.disabled = false;
    }
  }
}

function getSupportedMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined;
  }

  const types = ["audio/webm", "audio/ogg", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type));
}

function handleRecordingError(error) {
  console.error("Failed to start recording", error);

  stopButton.disabled = true;

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = undefined;
  }

  mediaRecorder = undefined;
  audioChunks = [];
  pendingRecording = null;
  noteMetaForm.hidden = true;
  discardNoteButton.disabled = true;

  let message = "Unable to access the microphone.";

  if (error && typeof error === "object") {
    const errorName = error.name || "";
    if (errorName === "NotAllowedError" || errorName === "SecurityError") {
      if (typeof window !== "undefined" && !window.isSecureContext) {
        message = [
          "Microphone access requires a secure context (https or localhost).",
          "Open this app from https:// or http://localhost and allow microphone access.",
        ].join(" ");
      } else {
        message =
          "Microphone access was blocked. Please allow permission in your browser settings and try again.";
      }
    } else if (errorName === "NotFoundError") {
      message =
        "No microphone was found. Connect a microphone and try again.";
    }
  }

  recordingStatus.textContent = message;
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    stopButton.disabled = true;
    recordButton.disabled = false;
    recordingStatus.textContent = "Processing recording...";
  }
}

function handleRecordingStop() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = undefined;
  }

  mediaRecorder = undefined;

  recordButton.disabled = false;
  stopButton.disabled = true;

  if (!audioChunks.length) {
    recordingStatus.textContent =
      "Recording failed. Please try capturing your voice note again.";
    resetPendingForm();
    return;
  }

  const blob = new Blob(audioChunks, { type: "audio/webm" });
  const reader = new FileReader();
  reader.onload = () => {
    pendingRecording = {
      audioData: reader.result,
      createdAt: new Date().toISOString(),
    };
    noteTitleInput.value = "";
    noteDescriptionInput.value = "";
    noteMetaForm.hidden = false;
    discardNoteButton.disabled = false;
    recordingStatus.textContent =
      "Recording captured! Add a title or notes, then save.";
  };
  reader.readAsDataURL(blob);
  audioChunks = [];
}

function savePendingRecording(event) {
  event.preventDefault();
  if (!pendingRecording) {
    return;
  }

  const title = noteTitleInput.value.trim();
  const description = noteDescriptionInput.value.trim();
  const createdAt = pendingRecording.createdAt;

  const note = {
    id: createId(),
    title: title || formatVoiceNoteTitle(createdAt),
    description,
    audioData: pendingRecording.audioData,
    createdAt,
  };

  voiceNotes.push(note);
  persistState(VOICE_NOTES_KEY, voiceNotes);
  renderVoiceNotes();
  resetPendingForm();
  recordingStatus.textContent = "Voice note saved.";
}

function discardPendingRecording() {
  resetPendingForm();
  recordingStatus.textContent = "Recording discarded.";
}

function resetPendingForm() {
  pendingRecording = null;
  noteMetaForm.hidden = true;
  noteTitleInput.value = "";
  noteDescriptionInput.value = "";
  discardNoteButton.disabled = true;
}

function renderVoiceNotes() {
  voiceNotesList.innerHTML = "";
  voiceNotesList.classList.toggle("empty", voiceNotes.length === 0);

  if (!voiceNotes.length) {
    const li = document.createElement("li");
    li.textContent = "No voice notes yet. Start recording to capture one!";
    voiceNotesList.append(li);
    return;
  }

  const sorted = [...voiceNotes].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  sorted.forEach((note) => {
    const fragment = voiceNoteTemplate.content.cloneNode(true);
    const li = fragment.querySelector(".note-item");
    const title = fragment.querySelector(".note-title");
    const description = fragment.querySelector(".note-description");
    const audio = fragment.querySelector(".note-audio");
    const timestamp = fragment.querySelector(".timestamp");
    const deleteButton = fragment.querySelector(".delete-note");
    const createTaskButton = fragment.querySelector(".create-task");

    title.textContent = note.title;
    description.textContent = note.description;
    audio.src = note.audioData;
    audio.type = "audio/webm";
    timestamp.textContent = formatDate(note.createdAt);

    deleteButton.addEventListener("click", () => {
      deleteVoiceNote(note.id);
    });

    createTaskButton.addEventListener("click", () => {
      createTaskFromNote(note);
    });

    voiceNotesList.append(li);
  });
}

function deleteVoiceNote(id) {
  const index = voiceNotes.findIndex((note) => note.id === id);
  if (index !== -1) {
    voiceNotes.splice(index, 1);
    persistState(VOICE_NOTES_KEY, voiceNotes);
    renderVoiceNotes();
  }
}

function formatVoiceNoteTitle(createdAt) {
  const date = new Date(createdAt);
  return `Voice note ${date.toLocaleString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function handleTaskSubmit(event) {
  event.preventDefault();
  const title = taskTitleInput.value.trim();
  if (!title) {
    taskTitleInput.focus();
    return;
  }

  const task = {
    id: createId(),
    title,
    details: taskDetailsInput.value.trim(),
    priority: taskPriorityInput.value,
    completed: false,
    createdAt: new Date().toISOString(),
  };

  tasks.push(task);
  persistState(TASKS_KEY, tasks);
  renderTasks();

  taskForm.reset();
  taskPriorityInput.value = "medium";
  taskTitleInput.focus();
}

function renderTasks() {
  taskList.innerHTML = "";
  taskList.classList.toggle("empty", tasks.length === 0);

  if (!tasks.length) {
    const li = document.createElement("li");
    li.textContent = "No tasks yet. Add your first to-do above!";
    taskList.append(li);
    return;
  }

  const sorted = [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    const priorityScore = {
      high: 3,
      medium: 2,
      low: 1,
    };
    if (priorityScore[b.priority] !== priorityScore[a.priority]) {
      return priorityScore[b.priority] - priorityScore[a.priority];
    }
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  sorted.forEach((task) => {
    const fragment = taskTemplate.content.cloneNode(true);
    const li = fragment.querySelector(".task-item");
    const chip = fragment.querySelector(".chip.priority");
    const title = fragment.querySelector(".task-title");
    const details = fragment.querySelector(".task-details");
    const completeCheckbox = fragment.querySelector(".complete");
    const deleteButton = fragment.querySelector(".delete-task");

    chip.textContent = task.priority;
    chip.classList.add(task.priority);
    title.textContent = task.title;
    details.textContent = task.details;
    completeCheckbox.checked = task.completed;
    li.classList.toggle("completed", task.completed);

    completeCheckbox.addEventListener("change", () => {
      toggleTaskCompletion(task.id, completeCheckbox.checked);
    });

    deleteButton.addEventListener("click", () => {
      deleteTask(task.id);
    });

    taskList.append(li);
  });
}

function toggleTaskCompletion(id, value) {
  const task = tasks.find((item) => item.id === id);
  if (task) {
    task.completed = value;
    persistState(TASKS_KEY, tasks);
    renderTasks();
  }
}

function deleteTask(id) {
  const index = tasks.findIndex((item) => item.id === id);
  if (index !== -1) {
    tasks.splice(index, 1);
    persistState(TASKS_KEY, tasks);
    renderTasks();
  }
}

function createTaskFromNote(note) {
  taskTitleInput.value = note.title;
  const detailLines = [];
  if (note.description) {
    detailLines.push(note.description);
  }
  detailLines.push(
    `Linked voice note captured ${formatDate(note.createdAt)}. Listen in the Voice Notes section.`
  );
  taskDetailsInput.value = detailLines.join("\n\n");
  taskPriorityInput.value = "high";
  taskTitleInput.focus();
  taskTitleInput.select();
}

window.addEventListener("beforeunload", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
});
