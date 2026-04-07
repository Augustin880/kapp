const STORAGE_KEY = "kapp.flashcards.v1";
const GRAMMAR_STORAGE_KEY = "kapp.grammar.v1";
const LIBRARY_STORAGE_KEY = "kapp.library.v1";
const SETTINGS_KEY = "kapp.settings.v1";
const ALL_DECKS = "All decks";

function generateId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `card-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value) {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "grammar-point";
}

function createSeedFlashcards() {
  return [];
}

function cleanImportedText(value) {
  return value
    .toString()
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function detectLanguageFromText(text, fallbackLanguage = "") {
  const source = text.toString().trim();
  if (!source) {
    return fallbackLanguage;
  }

  if (/[가-힣]/.test(source)) {
    return "Korean";
  }
  if (/[ぁ-ゖァ-ヺ]/.test(source)) {
    return "Japanese";
  }
  if (/[一-龯]/.test(source)) {
    return "Chinese";
  }
  if (/[а-яё]/i.test(source)) {
    return "Russian";
  }
  if (/[áéíóúñ¿¡]/i.test(source)) {
    return "Spanish";
  }
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(source)) {
    return "French";
  }
  if (/[äöüß]/i.test(source)) {
    return "German";
  }

  return fallbackLanguage || "Unknown";
}

function estimateDifficulty(text) {
  const source = cleanImportedText(text);
  if (!source) {
    return "Unknown";
  }

  const words = source.match(/[^\s]+/g) || [];
  const sentences = source.split(/[.!?]\s+|\n+/).filter((part) => part.trim());
  const averageSentenceLength = words.length / Math.max(1, sentences.length);
  const uniqueWords = new Set(words.map((word) => word.toLowerCase())).size;
  const uniqueRatio = uniqueWords / Math.max(1, words.length);

  if (words.length < 120 && averageSentenceLength < 10) {
    return "Beginner";
  }
  if (words.length > 450 || averageSentenceLength > 18 || uniqueRatio > 0.72) {
    return "Advanced";
  }

  return "Intermediate";
}

function parseTags(value) {
  return [...new Set(value.toString().split(",").map((tag) => tag.trim()).filter(Boolean))];
}

function splitTextIntoReadingChunks(text) {
  const source = cleanImportedText(text);
  if (!source) {
    return [];
  }

  const lines = source.split("\n");
  const chunks = [];

  for (let index = 0; index < lines.length; index += 5) {
    chunks.push(lines.slice(index, index + 5).join("\n"));
  }

  return chunks.length ? chunks : [source];
}

function renderTagChips(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "";
  }

  return `<div class="tag-row">${tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function extractPdfTextFromBuffer(arrayBuffer) {
  const source = new Uint8Array(arrayBuffer);
  let decoded = "";
  for (const byte of source) {
    decoded += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " ";
  }

  const chunks = [...decoded.matchAll(/\(([^()]*)\)/g)]
    .map((match) => match[1].replace(/\\([()\\])/g, "$1").replace(/\\n/g, "\n"))
    .filter((part) => /[A-Za-zÀ-ÿ\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(part));

  return cleanImportedText(chunks.join(" "));
}

function hydrateLibraryText(entry) {
  return {
    id: typeof entry.id === "string" ? entry.id : generateId(),
    language: typeof entry.language === "string" ? entry.language : "",
    title: typeof entry.title === "string" ? entry.title : "Untitled text",
    text: typeof entry.text === "string" ? cleanImportedText(entry.text) : "",
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === "string" && tag.trim()) : [],
    sourceName: typeof entry.sourceName === "string" ? entry.sourceName : "",
    sourceType: typeof entry.sourceType === "string" ? entry.sourceType : "text",
    detectedLanguage: typeof entry.detectedLanguage === "string" ? entry.detectedLanguage : "",
    difficulty: typeof entry.difficulty === "string" ? entry.difficulty : "Unknown",
    status: ["unread", "reading", "finished"].includes(entry.status) ? entry.status : "unread",
    progress: typeof entry.progress === "number" ? Math.max(0, Math.min(100, Math.round(entry.progress))) : 0,
    currentChunk: typeof entry.currentChunk === "number" ? Math.max(0, Math.round(entry.currentChunk)) : 0,
    wordCount: typeof entry.wordCount === "number" ? entry.wordCount : 0,
    characterCount: typeof entry.characterCount === "number" ? entry.characterCount : 0,
  };
}

function buildExportBundle(state) {
  return {
    app: "kapp",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    flashcards: state.flashcards,
    grammarPoints: state.grammarPoints,
    libraryTexts: state.libraryTexts,
  };
}

function hydrateImportBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("Invalid data file.");
  }

  return {
    settings: {
      targetLanguage: typeof bundle.settings?.targetLanguage === "string" ? bundle.settings.targetLanguage : "",
      customLanguages: Array.isArray(bundle.settings?.customLanguages)
        ? bundle.settings.customLanguages.filter((language) => typeof language === "string")
        : [],
      customDecks: Array.isArray(bundle.settings?.customDecks)
        ? bundle.settings.customDecks
            .filter((deck) => deck && typeof deck.language === "string" && typeof deck.name === "string")
            .map((deck) => ({ language: deck.language, name: deck.name }))
        : [],
    },
    flashcards: Array.isArray(bundle.flashcards) ? bundle.flashcards.map(hydrateCard) : [],
    grammarPoints: Array.isArray(bundle.grammarPoints) ? bundle.grammarPoints.map(hydrateGrammarPoint) : [],
    libraryTexts: Array.isArray(bundle.libraryTexts) ? bundle.libraryTexts.map(hydrateLibraryText) : [],
  };
}

function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalizeText(value) {
  return stripAnnotationMarkup(value).trim().toLowerCase();
}

function escapeHtml(value) {
  return value
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripAnnotationMarkup(value) {
  return value
    .toString()
    .replace(/\(\((.+?)::(.+?)\)\)/g, "$2")
    .replace(/\{\{(.+?)::(.+?)\}\}/g, "$1")
    .replace(/\[\[(.+?)\]\]/g, "$1");
}

function renderHighlightedText(value) {
  const source = value.toString();
  const pattern = /\(\((.+?)::(.+?)\)\)|\{\{(.+?)::(.+?)\}\}|\[\[(.+?)\]\]|\*\*(.+?)\*\*|__(.+?)__/g;
  let lastIndex = 0;
  let html = "";
  const supportedColors = new Set(["red", "green", "blue", "gold", "orange", "mint", "rose"]);

  for (const match of source.matchAll(pattern)) {
    const [raw, colorName, colorText, grammarText, grammarTitle, highlighted, boldText, italicText] = match;
    const start = match.index ?? 0;
    html += escapeHtml(source.slice(lastIndex, start));
    if (colorName) {
      const normalizedColor = supportedColors.has(colorName.trim().toLowerCase())
        ? colorName.trim().toLowerCase()
        : "accent";
      html += `<span class="inline-color inline-color-${escapeHtml(normalizedColor)}">${escapeHtml(
        colorText.trim(),
      )}</span>`;
    } else if (boldText) {
      html += `<strong>${escapeHtml(boldText.trim())}</strong>`;
    } else if (italicText) {
      html += `<em>${escapeHtml(italicText.trim())}</em>`;
    } else if (highlighted) {
      html += `<span class="inline-highlight">${escapeHtml(highlighted)}</span>`;
    } else {
      html += `<span class="grammar-inline-link" role="link" tabindex="0" data-grammar-id="${escapeHtml(grammarTitle.trim())}">${escapeHtml(grammarText.trim())}</span>`;
    }
    lastIndex = start + raw.length;
  }

  html += escapeHtml(source.slice(lastIndex));
  return html;
}

function renderHighlightedMultilineText(value) {
  return renderHighlightedText(value).replaceAll("\n", "<br />");
}

function getHighlightedTerms(value) {
  return [...value.toString().matchAll(/\[\[(.+?)\]\]/g)].map((match) => match[1].trim()).filter(Boolean);
}

function getMultipleChoiceAnswerText(value) {
  const highlightedTerms = getHighlightedTerms(value);
  if (highlightedTerms.length > 0) {
    return highlightedTerms.join(" / ");
  }

  return stripAnnotationMarkup(value).trim();
}

function getTypingAnswerText(value) {
  const highlightedTerms = getHighlightedTerms(value);
  if (highlightedTerms.length > 0) {
    return highlightedTerms.join(" ");
  }

  return stripAnnotationMarkup(value).trim();
}

function getTypingClozeParts(value) {
  const source = value.toString();
  const pattern = /\{\{(.+?)::(.+?)\}\}|\[\[(.+?)\]\]/g;
  const parts = [];
  let lastIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const [raw, grammarText, grammarId, highlighted] = match;
    const start = match.index ?? 0;
    const leadingText = source.slice(lastIndex, start);
    if (leadingText) {
      parts.push({ type: "text", value: leadingText });
    }

    if (highlighted) {
      parts.push({ type: "blank", value: highlighted.trim() });
    } else {
      parts.push({ type: "grammar-link", value: grammarText, grammarId: grammarId.trim() });
    }

    lastIndex = start + raw.length;
  }

  const trailingText = source.slice(lastIndex);
  if (trailingText) {
    parts.push({ type: "text", value: trailingText });
  }

  return parts;
}

function getSpeechLanguage(language) {
  const normalized = language.toString().trim().toLowerCase();
  const languageMap = {
    korean: "ko-KR",
    japanese: "ja-JP",
    chinese: "zh-CN",
    mandarin: "zh-CN",
    cantonese: "zh-HK",
    french: "fr-FR",
    spanish: "es-ES",
    german: "de-DE",
    italian: "it-IT",
    portuguese: "pt-PT",
    brazilian: "pt-BR",
    english: "en-US",
    dutch: "nl-NL",
    russian: "ru-RU",
  };

  return languageMap[normalized] || "";
}

function createEmptyStats() {
  return {
    attempts: 0,
    correct: 0,
    flashcardAttempts: 0,
    multipleChoiceAttempts: 0,
    typingAttempts: 0,
    lastPracticedAt: "",
  };
}

function hydrateCard(card) {
  const stats = card.stats || {};
  return {
    ...card,
    audio: typeof card.audio === "string" ? card.audio : "",
    score: typeof card.score === "number" ? card.score : 0,
    stats: {
      ...createEmptyStats(),
      ...stats,
    },
  };
}

function hydrateGrammarBlock(block) {
  return {
    id: typeof block.id === "string" ? block.id : generateId(),
    type: typeof block.type === "string" ? block.type : "text",
    title: typeof block.title === "string" ? block.title : "",
    content: typeof block.content === "string" ? block.content : "",
    children: Array.isArray(block.children)
      ? block.children.map(hydrateGrammarBlock).filter((child) => child.title || child.content || child.children.length)
      : [],
  };
}

function cloneGrammarBlock(block) {
  return {
    ...block,
    children: Array.isArray(block.children) ? block.children.map(cloneGrammarBlock) : [],
  };
}

function normalizeGrammarBlock(block) {
  const normalizedChildren = Array.isArray(block.children)
    ? block.children
        .map((child) => normalizeGrammarBlock(child))
        .filter((child) => child.title || child.content || child.children.length)
    : [];

  return {
    id: typeof block.id === "string" ? block.id : generateId(),
    type: typeof block.type === "string" ? block.type : "text",
    title: typeof block.title === "string" ? block.title.trim() : "",
    content: typeof block.content === "string" ? block.content.trim() : "",
    children: normalizedChildren,
  };
}

function hydrateGrammarPoint(point) {
  const legacyBlocks = [];
  if (typeof point.explanation === "string" && point.explanation.trim()) {
    legacyBlocks.push({
      id: generateId(),
      type: "text",
      title: "Explanation",
      content: point.explanation.trim(),
    });
  }
  if (Array.isArray(point.examples) && point.examples.length) {
    legacyBlocks.push({
      id: generateId(),
      type: "examples",
      title: "Examples",
      content: point.examples.join("\n"),
    });
  }
  if (Array.isArray(point.exercises) && point.exercises.length) {
    legacyBlocks.push({
      id: generateId(),
      type: "exercises",
      title: "Exercises",
      content: point.exercises.join("\n"),
    });
  }

  return {
    id: typeof point.id === "string" ? point.id : generateId(),
    referenceId:
      typeof point.referenceId === "string" && point.referenceId.trim()
        ? slugify(point.referenceId)
        : slugify(point.title || point.id || "grammar-point"),
    language: typeof point.language === "string" ? point.language : "",
    title: typeof point.title === "string" ? point.title : "",
    summary: typeof point.summary === "string" ? point.summary : "",
    blocks: Array.isArray(point.blocks)
      ? point.blocks.map(hydrateGrammarBlock).filter((block) => block.content || block.title || block.children.length)
      : legacyBlocks,
  };
}

if (!isBrowserRuntime()) {
  console.error("app.js is a browser entrypoint. Start the local server with: node server.js");
} else {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  const state = {
    activeTab: "flashcards",
    settings: loadSettings(),
    flashcards: loadFlashcards(),
    libraryTexts: loadLibraryTexts(),
    activeDeck: ALL_DECKS,
    sessionCardOrder: [],
    sessionCardDirections: {},
    selectedSettingsDeck: "",
    currentIndex: 0,
    flipped: false,
    importedAudio: "",
    editingCardId: "",
    grammarPoints: loadGrammarPoints(),
    activeGrammarId: "",
    editingGrammarId: "",
    activeLibraryTextId: "",
    editingLibraryTextId: "",
    selectedLibrarySnippet: "",
    libraryCaptureCollapsed: false,
    grammarView: "library",
    libraryView: "list",
    draftGrammarSections: [],
    studyMode: "flashcards",
    statisticsView: "charts",
    studyFeedback: "",
    studyAnsweredCardId: "",
    typingAnswerPendingCardId: "",
    pendingTypingReviewCardId: "",
    sessionGoal: 10,
    sessionReviewedIds: [],
    sessionAttempts: 0,
    sessionCorrect: 0,
    sessionComplete: false,
    sessionCompletionReason: "",
    advanceTimeoutId: 0,
    isAdvancing: false,
  };
  state.targetLanguage = state.settings.targetLanguage;

  const elements = {
    languageTabs: document.querySelector("#language-tabs"),
    addLanguageToggle: document.querySelector("#add-language-toggle"),
    addLanguageForm: document.querySelector("#add-language-form"),
    targetLanguageInput: document.querySelector("#target-language-input"),
    featureTabs: [...document.querySelectorAll(".feature-tab")],
    tabPanels: [...document.querySelectorAll(".tab-panel")],
    grammarPanelTitle: document.querySelector("#grammar-panel-title"),
    libraryPanelTitle: document.querySelector("#library-panel-title"),
    libraryBrowserView: document.querySelector("#library-browser-view"),
    libraryPageView: document.querySelector("#library-page-view"),
    libraryEditorView: document.querySelector("#library-editor-view"),
    grammarLibraryView: document.querySelector("#grammar-library-view"),
    grammarPageView: document.querySelector("#grammar-page-view"),
    grammarEditorView: document.querySelector("#grammar-editor-view"),
    grammarBackToLibrary: document.querySelector("#grammar-back-to-library"),
    grammarEditCurrent: document.querySelector("#grammar-edit-current"),
    grammarCreateNew: document.querySelector("#grammar-create-new"),
    grammarPage: document.querySelector("#grammar-page"),
    grammarList: document.querySelector("#grammar-list"),
    grammarCount: document.querySelector("#grammar-count"),
    grammarForm: document.querySelector("#grammar-form"),
    editingGrammarNote: document.querySelector("#editing-grammar-note"),
    saveGrammarButton: document.querySelector("#save-grammar-button"),
    cancelEditGrammar: document.querySelector("#cancel-edit-grammar"),
    addTextSection: document.querySelector("#add-text-section"),
    addExampleSection: document.querySelector("#add-example-section"),
    addExerciseSection: document.querySelector("#add-exercise-section"),
    addVideoSection: document.querySelector("#add-video-section"),
    grammarSectionsEditor: document.querySelector("#grammar-sections-editor"),
    grammarSectionTemplate: document.querySelector("#grammar-section-editor-template"),
    libraryCount: document.querySelector("#library-count"),
    librarySummaryStats: document.querySelector("#library-summary-stats"),
    libraryImportForm: document.querySelector("#library-import-form"),
    libraryTitleInput: document.querySelector("#library-title-input"),
    libraryTagsInput: document.querySelector("#library-tags-input"),
    libraryDifficultyInput: document.querySelector("#library-difficulty-input"),
    libraryFileInput: document.querySelector("#library-file-input"),
    libraryTextInput: document.querySelector("#library-text-input"),
    libraryImportStatus: document.querySelector("#library-import-status"),
    saveLibraryTextButton: document.querySelector("#save-library-text-button"),
    libraryList: document.querySelector("#library-list"),
    libraryReaderMeta: document.querySelector("#library-reader-meta"),
    libraryBackToList: document.querySelector("#library-back-to-list"),
    editLibraryText: document.querySelector("#edit-library-text"),
    editingLibraryNote: document.querySelector("#editing-library-note"),
    libraryEditForm: document.querySelector("#library-edit-form"),
    libraryEditTitleInput: document.querySelector("#library-edit-title-input"),
    libraryEditTagsInput: document.querySelector("#library-edit-tags-input"),
    libraryEditDifficultyInput: document.querySelector("#library-edit-difficulty-input"),
    libraryEditTextInput: document.querySelector("#library-edit-text-input"),
    libraryGrammarSuggestions: document.querySelector("#library-grammar-suggestions"),
    cancelEditLibraryText: document.querySelector("#cancel-edit-library-text"),
    libraryReadingProgress: document.querySelector("#library-reading-progress"),
    libraryReaderContent: document.querySelector("#library-reader-content"),
    libraryCapturePanel: document.querySelector(".library-capture-panel"),
    toggleLibraryCapture: document.querySelector("#toggle-library-capture"),
    libraryCaptureBody: document.querySelector("#library-capture-body"),
    libraryUseSelection: document.querySelector("#library-use-selection"),
    librarySelectionStatus: document.querySelector("#library-selection-status"),
    libraryCardForm: document.querySelector("#library-card-form"),
    librarySnippetInput: document.querySelector("#library-snippet-input"),
    libraryDeckSelect: document.querySelector("#library-deck-select"),
    libraryNewDeckInput: document.querySelector("#library-new-deck-input"),
    libraryReaderActions: document.querySelector("#library-reader-actions"),
    libraryPreviousChunk: document.querySelector("#library-previous-chunk"),
    libraryNextChunk: document.querySelector("#library-next-chunk"),
    deleteLibraryText: document.querySelector("#delete-library-text"),
    card: document.querySelector("#flashcard"),
    cardFrontText: document.querySelector("#card-front-text"),
    cardFrontMeta: document.querySelector("#card-front-meta"),
    cardBackText: document.querySelector("#card-back-text"),
    cardBackMeta: document.querySelector("#card-back-meta"),
    deckFilter: document.querySelector("#deck-filter"),
    sessionGoal: document.querySelector("#session-goal"),
    restartSession: document.querySelector("#restart-session"),
    studyProgress: document.querySelector("#study-progress"),
    studySessionContent: document.querySelector("#study-session-content"),
    studyModeTabs: [...document.querySelectorAll(".mode-tab[data-study-mode]")],
    studyPractice: document.querySelector("#study-practice"),
    form: document.querySelector("#flashcard-form"),
    editingCardNote: document.querySelector("#editing-card-note"),
    saveCardButton: document.querySelector("#save-card-button"),
    cancelEditCard: document.querySelector("#cancel-edit-card"),
    cardList: document.querySelector("#flashcard-list"),
    cardCount: document.querySelector("#card-count"),
    grammarLinkTarget: document.querySelector("#grammar-link-target"),
    grammarLinkText: document.querySelector("#grammar-link-text"),
    grammarLinkSelect: document.querySelector("#grammar-link-select"),
    insertGrammarLink: document.querySelector("#insert-grammar-link"),
    flipCard: document.querySelector("#flip-card"),
    nextCard: document.querySelector("#next-card"),
    playAudio: document.querySelector("#play-audio"),
    markHard: document.querySelector("#mark-hard"),
    markMedium: document.querySelector("#mark-medium"),
    markEasy: document.querySelector("#mark-easy"),
    template: document.querySelector("#flashcard-list-item-template"),
    audioFileInput: document.querySelector("#audio-file-input"),
    playRecording: document.querySelector("#play-recording"),
    clearRecording: document.querySelector("#clear-recording"),
    recordingStatus: document.querySelector("#recording-status"),
    recordingPreview: document.querySelector("#recording-preview"),
    sessionEndScreen: document.querySelector("#session-end-screen"),
    sessionEndTitle: document.querySelector("#session-end-title"),
    sessionEndStats: document.querySelector("#session-end-stats"),
    sessionEndSummary: document.querySelector("#session-end-summary"),
    startNextSession: document.querySelector("#start-next-session"),
    practicePrompt: document.querySelector("#practice-prompt"),
    practiceMeta: document.querySelector("#practice-meta"),
    multipleChoicePanel: document.querySelector("#multiple-choice-panel"),
    multipleChoiceOptions: document.querySelector("#multiple-choice-options"),
    typingForm: document.querySelector("#typing-form"),
    typingCloze: document.querySelector("#typing-cloze"),
    typingAnswerLabel: document.querySelector("#typing-answer-label"),
    typingAnswerInput: document.querySelector("#typing-answer-input"),
    acceptTypingAnswer: document.querySelector("#accept-typing-answer"),
    practiceFeedback: document.querySelector("#practice-feedback"),
    languageSummaryStats: document.querySelector("#language-summary-stats"),
    languageChart: document.querySelector("#language-chart"),
    deckSummaryStats: document.querySelector("#deck-summary-stats"),
    deckChart: document.querySelector("#deck-chart"),
    cardStatList: document.querySelector("#card-stat-list"),
    statisticsViewTabs: [...document.querySelectorAll("[data-stats-view]")],
    deckSummary: document.querySelector("#deck-summary"),
    deckCount: document.querySelector("#deck-count"),
    dataTransferStatus: document.querySelector("#data-transfer-status"),
    exportAppData: document.querySelector("#export-app-data"),
    importAppDataForm: document.querySelector("#import-app-data-form"),
    importAppDataFile: document.querySelector("#import-app-data-file"),
    importAppDataButton: document.querySelector("#import-app-data-button"),
    createDeckForm: document.querySelector("#create-deck-form"),
    settingsDeckTitle: document.querySelector("#settings-deck-title"),
    selectedDeckMeta: document.querySelector("#selected-deck-meta"),
    renameSelectedDeckForm: document.querySelector("#rename-selected-deck-form"),
    renameSelectedDeckInput: document.querySelector("#rename-selected-deck-input"),
    deleteSelectedDeck: document.querySelector("#delete-selected-deck"),
    cardFormDeckLabel: document.querySelector("#card-form-deck-label"),
  };

  function loadFlashcards() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const initialFlashcards = createSeedFlashcards();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialFlashcards));
      return initialFlashcards;
    }

    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return createSeedFlashcards();
      }

      return parsed.map(hydrateCard);
    } catch {
      const initialFlashcards = createSeedFlashcards();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialFlashcards));
      return initialFlashcards;
    }
  }

  function loadGrammarPoints() {
    const stored = localStorage.getItem(GRAMMAR_STORAGE_KEY);
    if (!stored) {
      localStorage.setItem(GRAMMAR_STORAGE_KEY, JSON.stringify([]));
      return [];
    }

    try {
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(hydrateGrammarPoint);
    } catch {
      return [];
    }
  }

  function loadLibraryTexts() {
    const stored = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!stored) {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify([]));
      return [];
    }

    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed.map(hydrateLibraryText) : [];
    } catch {
      return [];
    }
  }

  function loadSettings() {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) {
      return { targetLanguage: "", customLanguages: [], customDecks: [] };
    }

    try {
      const parsed = JSON.parse(stored);
      return {
        targetLanguage: typeof parsed.targetLanguage === "string" ? parsed.targetLanguage : "",
        customLanguages: Array.isArray(parsed.customLanguages)
          ? parsed.customLanguages.filter((language) => typeof language === "string")
          : [],
        customDecks: Array.isArray(parsed.customDecks)
          ? parsed.customDecks
              .filter((deck) => deck && typeof deck.language === "string" && typeof deck.name === "string")
              .map((deck) => ({ language: deck.language, name: deck.name }))
          : [],
      };
    } catch {
      return { targetLanguage: "", customLanguages: [], customDecks: [] };
    }
  }

  function persistFlashcards() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.flashcards));
  }

  function persistGrammarPoints() {
    localStorage.setItem(GRAMMAR_STORAGE_KEY, JSON.stringify(state.grammarPoints));
  }

  function persistLibraryTexts() {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(state.libraryTexts));
  }

  function persistSettings() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        targetLanguage: state.targetLanguage,
        customLanguages: state.settings.customLanguages,
        customDecks: state.settings.customDecks,
      }),
    );
  }

  function getLanguages() {
    return [
      ...new Set([
        ...state.settings.customLanguages.map((language) => language.trim()).filter(Boolean),
        ...state.flashcards.map((card) => card.language),
        ...state.libraryTexts.map((entry) => entry.language),
        ...state.grammarPoints.map((point) => point.language),
      ]),
    ].sort((left, right) => left.localeCompare(right));
  }

  function getCardsForLanguage(language) {
    if (!language) {
      return [];
    }

    return state.flashcards.filter((card) => card.language === language);
  }

  function getGrammarForLanguage(language) {
    if (!language) {
      return [];
    }

    return state.grammarPoints.filter((point) => point.language === language);
  }

  function getLibraryTextsForLanguage(language) {
    if (!language) {
      return [];
    }

    return state.libraryTexts.filter((entry) => entry.language === language);
  }

  function getCardsForTargetLanguage() {
    return getCardsForLanguage(state.targetLanguage);
  }

  function getGrammarForTargetLanguage() {
    return getGrammarForLanguage(state.targetLanguage);
  }

  function getLibraryTextsForTargetLanguage() {
    return getLibraryTextsForLanguage(state.targetLanguage);
  }

  function getDecks(language = state.targetLanguage) {
    return [
      ...new Set([
        ...state.settings.customDecks
          .filter((deck) => deck.language === language)
          .map((deck) => deck.name),
        ...getCardsForLanguage(language).map((card) => card.deck),
      ]),
    ].sort();
  }

  function getActiveLibraryText() {
    const texts = getLibraryTextsForTargetLanguage();
    if (texts.length === 0) {
      state.activeLibraryTextId = "";
      return null;
    }

    const active = texts.find((entry) => entry.id === state.activeLibraryTextId);
    if (active) {
      return active;
    }

    state.activeLibraryTextId = texts[0].id;
    return texts[0];
  }

  function getEditingLibraryText() {
    return state.libraryTexts.find((entry) => entry.id === state.editingLibraryTextId) || null;
  }

  function getPendingGrammarLinkMatch(value, cursorIndex) {
    if (typeof cursorIndex !== "number") {
      return null;
    }

    for (const match of value.toString().matchAll(/\{\{([^{}]+?)::\}\}/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (cursorIndex < start || cursorIndex > end) {
        continue;
      }

      return {
        fullMatch: match[0],
        visibleText: match[1].trim(),
        start,
        end,
      };
    }

    return null;
  }

  function getAccuracy(card) {
    return card.stats.attempts === 0 ? 0 : Math.round((card.stats.correct / card.stats.attempts) * 100);
  }

  function isKnownCard(card) {
    return card.stats.attempts >= 20 && getAccuracy(card) >= 98;
  }

  function getPracticeCards() {
    return getVisibleFlashcards();
  }

  function getCardsForSettingsDeck() {
    if (!state.selectedSettingsDeck) {
      return [];
    }

    return getCardsForTargetLanguage().filter((card) => card.deck === state.selectedSettingsDeck);
  }

  function ensureCustomDeck(language, deckName) {
    if (!language || !deckName) {
      return;
    }

    const exists = state.settings.customDecks.some((deck) => deck.language === language && deck.name === deckName);
    if (!exists) {
      state.settings.customDecks = [...state.settings.customDecks, { language, name: deckName }];
    }
  }

  function removeCustomDeck(language, deckName) {
    state.settings.customDecks = state.settings.customDecks.filter(
      (deck) => !(deck.language === language && deck.name === deckName),
    );
  }

  function getVisibleFlashcards() {
    return getCardsForTargetLanguage().filter((card) => {
      return state.activeDeck === ALL_DECKS || card.deck === state.activeDeck;
    });
  }

  function shuffleArray(items) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    }
    return next;
  }

  function getStudyPriorityWeight(card) {
    const attempts = card.stats.attempts;
    const accuracy = getAccuracy(card) / 100;
    const practiceGap = Math.max(0, 1 - Math.min(attempts, 20) / 20);
    const accuracyGap = 1 - accuracy;
    const knownPenalty = isKnownCard(card) ? 0.08 : 1;

    return (1 + practiceGap * 4 + accuracyGap * 6) * knownPenalty;
  }

  function weightedShuffleCards(cards) {
    const pool = cards.map((card) => ({ card, weight: getStudyPriorityWeight(card) }));
    const ordered = [];

    while (pool.length > 0) {
      const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
      let threshold = Math.random() * totalWeight;
      let selectedIndex = 0;

      for (let index = 0; index < pool.length; index += 1) {
        threshold -= pool[index].weight;
        if (threshold <= 0) {
          selectedIndex = index;
          break;
        }
      }

      const [selected] = pool.splice(selectedIndex, 1);
      ordered.push(selected.card);
    }

    return ordered;
  }

  function syncSessionCardOrder() {
    const visibleCards = getVisibleFlashcards();
    const visibleIds = visibleCards.map((card) => card.id);
    if (visibleCards.length === 0) {
      state.sessionCardOrder = [];
      return;
    }

    const remainingIds = state.sessionCardOrder.filter((id) => visibleIds.includes(id));
    const newCards = visibleCards.filter((card) => !remainingIds.includes(card.id));
    state.sessionCardOrder = [...remainingIds, ...weightedShuffleCards(newCards).map((card) => card.id)];
  }

  function randomizeSessionCardOrder() {
    state.sessionCardOrder = weightedShuffleCards(getVisibleFlashcards()).map((card) => card.id);
  }

  function getCurrentCard() {
    syncSessionCardOrder();
    if (state.sessionCardOrder.length === 0) {
      return null;
    }

    if (state.currentIndex >= state.sessionCardOrder.length) {
      state.currentIndex = 0;
    }

    return state.flashcards.find((card) => card.id === state.sessionCardOrder[state.currentIndex]) || null;
  }

  function getStudyDirection(cardId) {
    if (!cardId) {
      return "forward";
    }

    if (!state.sessionCardDirections[cardId]) {
      state.sessionCardDirections[cardId] = Math.random() < 0.5 ? "reverse" : "forward";
    }

    return state.sessionCardDirections[cardId];
  }

  function getCardStudyContent(card, directionOverride = "") {
    const direction = directionOverride || getStudyDirection(card?.id);
    const isReverse = direction === "reverse";
    return {
      direction,
      isReverse,
      prompt: isReverse ? card.answer : card.prompt,
      answer: isReverse ? card.prompt : card.answer,
      hint: isReverse ? "" : card.hint || "",
    };
  }

  function getSessionTargetCount() {
    const visibleCards = getVisibleFlashcards();
    return Math.min(state.sessionGoal, visibleCards.length || state.sessionGoal);
  }

  function cancelPendingAdvance() {
    if (state.advanceTimeoutId) {
      window.clearTimeout(state.advanceTimeoutId);
      state.advanceTimeoutId = 0;
    }
    state.isAdvancing = false;
  }

  function clearStudyAnswerState() {
    state.studyFeedback = "";
    state.studyAnsweredCardId = "";
    state.typingAnswerPendingCardId = "";
    state.pendingTypingReviewCardId = "";
    elements.typingForm?.reset();
  }

  function finalizePendingTypingReview(isCorrect) {
    if (!state.pendingTypingReviewCardId) {
      return;
    }

    registerSessionReview(state.pendingTypingReviewCardId, isCorrect);
    state.pendingTypingReviewCardId = "";
  }

  function resetSession() {
    cancelPendingAdvance();
    state.currentIndex = 0;
    state.flipped = false;
    randomizeSessionCardOrder();
    state.sessionCardDirections = {};
    clearStudyAnswerState();
    state.sessionReviewedIds = [];
    state.sessionAttempts = 0;
    state.sessionCorrect = 0;
    state.sessionComplete = false;
    state.sessionCompletionReason = "";
  }

  function maybeCompleteSession() {
    const visibleCards = getVisibleFlashcards();
    if (visibleCards.length === 0) {
      return;
    }

    const reachedGoal = state.sessionReviewedIds.length >= getSessionTargetCount();
    const finishedDeck = state.sessionReviewedIds.length >= visibleCards.length;

    if (!state.sessionComplete && (reachedGoal || finishedDeck)) {
      state.sessionComplete = true;
      state.sessionCompletionReason = finishedDeck ? "deck" : "goal";
    }
  }

  function registerSessionReview(cardId, isCorrect) {
    if (!state.sessionReviewedIds.includes(cardId)) {
      state.sessionReviewedIds = [...state.sessionReviewedIds, cardId];
    }
    state.sessionAttempts += 1;
    state.sessionCorrect += isCorrect ? 1 : 0;
    maybeCompleteSession();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function clearImportedAudio() {
    state.importedAudio = "";
    elements.recordingPreview.pause();
    elements.recordingPreview.removeAttribute("src");
    elements.recordingPreview.hidden = true;
    if (elements.audioFileInput) {
      elements.audioFileInput.value = "";
    }
    syncAudioImportUi();
  }

  function getEditingCard() {
    return state.flashcards.find((card) => card.id === state.editingCardId) || null;
  }

  function getEditingGrammarPoint() {
    return state.grammarPoints.find((point) => point.id === state.editingGrammarId) || null;
  }

  function getActiveGrammarPoint() {
    const points = getGrammarForTargetLanguage();
    if (points.length === 0) {
      state.activeGrammarId = "";
      return null;
    }

    const active = points.find((point) => point.id === state.activeGrammarId);
    if (active) {
      return active;
    }

    state.activeGrammarId = points[0].id;
    return points[0];
  }

  function openGrammarPointByReference(referenceId) {
    const nextReferenceId = slugify(referenceId);
    if (!nextReferenceId || !state.targetLanguage) {
      return;
    }

    const point = getGrammarForTargetLanguage().find((entry) => entry.referenceId === nextReferenceId);
    if (!point) {
      return;
    }

    state.activeGrammarId = point.id;
    state.grammarView = "page";
    state.activeTab = "grammar";
    render();
  }

  function parseTextareaList(value) {
    return value
      .toString()
      .split("\n")
      .map((item) => item.trim().replaceAll("\\n", "\n"))
      .filter(Boolean);
  }

  function createGrammarBlock(type) {
    const presets = {
      text: {
        title: "Explanation",
        content: "",
      },
      examples: {
        title: "Examples",
        content: "",
      },
      exercises: {
        title: "Exercises",
        content: "",
      },
      video: {
        title: "Video",
        content: "",
      },
    };

    return {
      id: generateId(),
      type,
      title: presets[type]?.title || "Section",
      content: presets[type]?.content || "",
      children: [],
    };
  }

  function getGrammarSectionConfig(type) {
    if (type === "examples") {
      return { label: "Examples", bodyLabel: "One example per line. Use \\n for line breaks inside one example.", rows: 5 };
    }
    if (type === "exercises") {
      return { label: "Exercises", bodyLabel: "One exercise per line. Use \\n for line breaks inside one exercise.", rows: 5 };
    }
    if (type === "video") {
      return { label: "YouTube video", bodyLabel: "Paste a YouTube link", rows: 3 };
    }
    return {
      label: "Text section",
      bodyLabel: "Write the section content. Use ((green::text)) or other colors like red, blue, gold, orange, mint, rose.",
      rows: 6,
    };
  }

  function extractYouTubeEmbedUrl(url) {
    const source = url.toString().trim();
    if (!source) {
      return "";
    }

    try {
      const parsed = new URL(source);
      if (parsed.hostname.includes("youtu.be")) {
        const id = parsed.pathname.replaceAll("/", "");
        return id ? `https://www.youtube.com/embed/${id}` : "";
      }

      if (parsed.hostname.includes("youtube.com")) {
        const id = parsed.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : "";
      }
    } catch {
      return "";
    }

    return "";
  }

  function stopEditingCard() {
    state.editingCardId = "";
    state.importedAudio = "";
    elements.form.reset();
    syncAudioImportUi();
  }

  function stopEditingGrammarPoint() {
    state.editingGrammarId = "";
    state.draftGrammarSections = [];
    elements.grammarForm.reset();
  }

  function stopEditingLibraryText() {
    state.editingLibraryTextId = "";
    elements.libraryEditForm.reset();
  }

  function startEditingCard(cardId) {
    const card = state.flashcards.find((entry) => entry.id === cardId);
    if (!card) {
      return;
    }

    state.editingCardId = card.id;
    state.selectedSettingsDeck = card.deck;
    elements.form.elements.prompt.value = card.prompt;
    elements.form.elements.hint.value = card.hint || "";
    elements.form.elements.answer.value = card.answer;
    elements.form.elements.notes.value = card.notes || "";
    state.importedAudio = card.audio || "";
    syncAudioImportUi();
  }

  function startEditingGrammarPoint(pointId) {
    const point = state.grammarPoints.find((entry) => entry.id === pointId);
    if (!point) {
      return;
    }

    state.editingGrammarId = point.id;
    state.activeGrammarId = point.id;
    state.grammarView = "editor";
    elements.grammarForm.elements.title.value = point.title;
    elements.grammarForm.elements.summary.value = point.summary;
    state.draftGrammarSections = point.blocks.map(cloneGrammarBlock);
  }

  function startEditingLibraryText(textId) {
    const entry = state.libraryTexts.find((item) => item.id === textId);
    if (!entry) {
      return;
    }

    state.editingLibraryTextId = entry.id;
    state.libraryView = "editor";
    elements.libraryEditTitleInput.value = entry.title;
    elements.libraryEditTagsInput.value = entry.tags.join(", ");
    elements.libraryEditDifficultyInput.value = entry.difficulty || "Intermediate";
    elements.libraryEditTextInput.value = entry.text;
    renderLibraryGrammarSuggestions();
  }

  function applyLibraryGrammarSuggestion(referenceId) {
    const field = elements.libraryEditTextInput;
    const match = getPendingGrammarLinkMatch(field.value, field.selectionStart ?? 0);
    if (!match) {
      return;
    }

    field.value = `${field.value.slice(0, match.start)}{{${match.visibleText}::${referenceId}}}${field.value.slice(match.end)}`;
    const nextPosition = match.start + `{{${match.visibleText}::${referenceId}}}`.length;
    field.focus();
    field.setSelectionRange(nextPosition, nextPosition);
    renderLibraryGrammarSuggestions();
  }

  function renderLibraryGrammarSuggestions() {
    const field = elements.libraryEditTextInput;
    const suggestions = elements.libraryGrammarSuggestions;
    if (!field || !suggestions || state.libraryView !== "editor") {
      return;
    }

    const match = getPendingGrammarLinkMatch(field.value, field.selectionStart ?? 0);
    if (!match) {
      suggestions.innerHTML = "";
      suggestions.classList.add("hidden");
      return;
    }

    const grammarPoints = getGrammarForTargetLanguage();
    if (grammarPoints.length === 0) {
      suggestions.innerHTML = `<p class="list-meta">No grammar points available for this language.</p>`;
      suggestions.classList.remove("hidden");
      return;
    }

    suggestions.innerHTML = `
      <p class="panel-kicker">Choose grammar rule for "${escapeHtml(match.visibleText)}"</p>
      <div class="grammar-inline-picker-list">
        ${grammarPoints
          .map(
            (point) => `
              <button class="secondary library-grammar-suggestion" type="button" data-grammar-reference="${escapeHtml(point.referenceId)}">
                ${escapeHtml(point.title)}
              </button>
            `,
          )
          .join("")}
      </div>
    `;
    suggestions.classList.remove("hidden");

    [...suggestions.querySelectorAll(".library-grammar-suggestion")].forEach((button) => {
      button.addEventListener("click", () => applyLibraryGrammarSuggestion(button.dataset.grammarReference || ""));
    });
  }

  function renderCardFormState() {
    const isEditing = Boolean(getEditingCard());
    elements.saveCardButton.textContent = isEditing ? "Save changes" : "Save card";
    elements.cancelEditCard.classList.toggle("hidden", !isEditing);
    elements.editingCardNote.classList.toggle("hidden", !isEditing);
    elements.cardFormDeckLabel.textContent = state.selectedSettingsDeck
      ? `Working in deck: ${state.selectedSettingsDeck}`
      : "Choose a deck before adding cards.";
    [...elements.form.querySelectorAll("input, textarea, button[type='submit']")].forEach((field) => {
      if (field.id === "audio-file-input") {
        field.disabled = !state.selectedSettingsDeck && !isEditing;
        return;
      }
      field.disabled = !state.selectedSettingsDeck && !isEditing;
    });
  }

  function renderGrammarFormState() {
    const isEditing = Boolean(getEditingGrammarPoint());
    elements.saveGrammarButton.textContent = isEditing ? "Save changes" : "Save grammar point";
    elements.cancelEditGrammar.classList.toggle("hidden", !isEditing);
    elements.editingGrammarNote.classList.toggle("hidden", !isEditing);
  }

  function renderGrammarLinkSuggestions() {
    const points = getGrammarForTargetLanguage();
    elements.grammarLinkSelect.innerHTML = [
      `<option value="">Choose a grammar rule</option>`,
      ...points.map(
        (point) => `<option value="${escapeHtml(point.referenceId)}">${escapeHtml(point.title)}</option>`,
      ),
    ]
      .join("");
  }

  function renderGrammarSectionsEditor() {
    elements.grammarSectionsEditor.innerHTML = "";

    if (state.draftGrammarSections.length === 0) {
      elements.grammarSectionsEditor.innerHTML = `<p class="list-meta">Add sections to build the grammar page.</p>`;
      return;
    }

    const renderSectionLevel = (sections, container, depth = 0) => {
      sections.forEach((section, index) => {
      const config = getGrammarSectionConfig(section.type);
      const item = elements.grammarSectionTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.sectionId = section.id;
      item.dataset.sectionDepth = String(depth);
      item.querySelector(".grammar-section-editor-label").textContent = config.label;
      item.querySelector(".grammar-section-title").value = section.title;
      item.querySelector(".grammar-section-body-copy").textContent = config.bodyLabel;
      const body = item.querySelector(".grammar-section-body");
      body.rows = config.rows;
      body.value = section.content;

      item.querySelector(".grammar-section-title").addEventListener("input", (event) => {
        section.title = event.target.value;
      });

      body.addEventListener("input", (event) => {
        section.content = event.target.value;
      });

      const moveUpButton = item.querySelector(".move-grammar-section-up");
      const moveDownButton = item.querySelector(".move-grammar-section-down");
      const childContainer = item.querySelector(".grammar-subsections-editor");
      moveUpButton.disabled = index === 0;
      moveDownButton.disabled = index === sections.length - 1;

      moveUpButton.addEventListener("click", () => {
        if (index === 0) {
          return;
        }

        [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
        renderGrammarSectionsEditor();
      });

      moveDownButton.addEventListener("click", () => {
        if (index === sections.length - 1) {
          return;
        }

        [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];
        renderGrammarSectionsEditor();
      });

      [...item.querySelectorAll(".add-subsection")].forEach((button) => {
        button.addEventListener("click", () => {
          section.children = [...(section.children || []), createGrammarBlock(button.dataset.subsectionType || "text")];
          renderGrammarSectionsEditor();
        });
      });

      item.querySelector(".remove-grammar-section").addEventListener("click", () => {
        sections.splice(index, 1);
        renderGrammarSectionsEditor();
      });

      if (section.children?.length) {
        renderSectionLevel(section.children, childContainer, depth + 1);
      } else {
        childContainer.innerHTML = `<p class="list-meta">No subsections yet.</p>`;
      }

      container.append(item);
      });
    };

    renderSectionLevel(state.draftGrammarSections, elements.grammarSectionsEditor);
  }

  function syncAudioImportUi() {
    const hasAudio = Boolean(state.importedAudio);
    elements.playRecording.disabled = !hasAudio;
    elements.clearRecording.disabled = !hasAudio;

    if (hasAudio) {
      elements.recordingStatus.textContent = "Audio file attached";
      elements.recordingPreview.src = state.importedAudio;
      elements.recordingPreview.hidden = false;
    } else {
      elements.recordingStatus.textContent = "No audio file";
      elements.recordingPreview.hidden = true;
    }
  }

  function playAudioSource(audioSource, fallbackText = "", language = "") {
    if (audioSource) {
      const player = new Audio(audioSource);
      player.play().catch(() => {});
      return;
    }

    const speechText = stripAnnotationMarkup(fallbackText).trim();
    if (!speechText || typeof window.speechSynthesis === "undefined") {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    const utteranceLanguage = getSpeechLanguage(language);
    if (utteranceLanguage) {
      utterance.lang = utteranceLanguage;
    }
    window.speechSynthesis.speak(utterance);
  }

  function recordPractice(cardId, isCorrect, mode) {
    const targetCard = state.flashcards.find((card) => card.id === cardId);
    if (!targetCard) {
      return;
    }

    targetCard.stats.attempts += 1;
    targetCard.stats.correct += isCorrect ? 1 : 0;
    targetCard.stats.lastPracticedAt = new Date().toISOString();
    if (mode === "flashcard") {
      targetCard.stats.flashcardAttempts += 1;
    } else if (mode === "multiple-choice") {
      targetCard.stats.multipleChoiceAttempts += 1;
    } else if (mode === "typing") {
      targetCard.stats.typingAttempts += 1;
    }
  }

  function setTargetLanguage(language) {
    state.targetLanguage = language;
    state.settings.targetLanguage = language;
    state.activeDeck = ALL_DECKS;
    state.activeGrammarId = "";
    state.activeLibraryTextId = "";
    state.selectedSettingsDeck = "";
    stopEditingCard();
    stopEditingGrammarPoint();
    resetSession();
    persistSettings();
  }

  function createMetricCard(value, label) {
    return `
      <div class="metric-card">
        <strong>${value}</strong>
        <span>${label}</span>
      </div>
    `;
  }

  function createBarChartRows(rows, emptyText) {
    if (rows.length === 0) {
      return `<p class="list-meta">${emptyText}</p>`;
    }

    return rows
      .map(
        (row) => `
          <div class="bar-row">
            <div class="bar-row-head">
              <span>${row.label}</span>
              <span>${row.valueLabel}</span>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width: ${Math.max(4, row.percent)}%"></div>
            </div>
          </div>
        `,
      )
      .join("");
  }

  function createTableRows(headers, rows, emptyText) {
    if (rows.length === 0) {
      return `<p class="list-meta">${emptyText}</p>`;
    }

    return `
      <div class="stats-table">
        <div class="stats-table-row stats-table-head">
          ${headers.map((header) => `<span>${header}</span>`).join("")}
        </div>
        ${rows
          .map(
            (row) => `
              <div class="stats-table-row">
                ${row.map((cell) => `<span>${cell}</span>`).join("")}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderHeroStats() {
    if (!elements.heroStats) {
      return;
    }

    const cards = getCardsForTargetLanguage();
    const studied = cards.filter((card) => card.stats.attempts > 0).length;
    const known = cards.filter(isKnownCard).length;
    const accuracy =
      cards.reduce((sum, card) => sum + card.stats.correct, 0) /
      Math.max(1, cards.reduce((sum, card) => sum + card.stats.attempts, 0));

    elements.heroStats.innerHTML = `
      <p class="panel-kicker">Current language</p>
      <div class="stat-grid">
        <div class="stat-card">
          <strong>${state.targetLanguage || "None"}</strong>
          <span>Target language</span>
        </div>
        <div class="stat-card">
          <strong>${studied}</strong>
          <span>Cards studied</span>
        </div>
        <div class="stat-card">
          <strong>${Math.round(accuracy * 100)}%</strong>
          <span>Overall accuracy</span>
        </div>
      </div>
      <p class="list-meta">${
        state.targetLanguage
          ? `${known} cards are currently considered known in ${state.targetLanguage}.`
          : "Set a target language to activate the learning modules."
      }</p>
    `;
  }

  function renderLanguageTabs() {
    const languages = getLanguages();
    elements.languageTabs.innerHTML = "";

    if (languages.length === 0) {
      elements.languageTabs.innerHTML = `<p class="list-meta">No languages yet. Add one to start shaping the app.</p>`;
      return;
    }

    languages.forEach((language) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `language-tab${language === state.targetLanguage ? " is-active" : ""}`;
      button.textContent = language;
      button.addEventListener("click", () => {
        setTargetLanguage(language);
        render();
      });
      elements.languageTabs.append(button);
    });
  }

  function renderTabs() {
    elements.featureTabs.forEach((tab) => {
      const isActive = tab.dataset.tab === state.activeTab;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    elements.tabPanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === state.activeTab);
    });
  }

  function renderDecks() {
    const decks = getDecks();
    if (!decks.includes(state.activeDeck)) {
      state.activeDeck = ALL_DECKS;
    }
    if (!decks.includes(state.selectedSettingsDeck)) {
      state.selectedSettingsDeck = decks[0] || "";
    }

    const deckOptions = [
      `<option value="${ALL_DECKS}" ${state.activeDeck === ALL_DECKS ? "selected" : ""}>${ALL_DECKS}</option>`,
      ...decks.map(
        (deck) =>
          `<option value="${deck}" ${deck === state.activeDeck ? "selected" : ""}>${deck}</option>`,
      ),
    ].join("");

    elements.deckFilter.innerHTML = state.targetLanguage ? deckOptions : `<option>${ALL_DECKS}</option>`;
    elements.deckFilter.disabled = !state.targetLanguage;
  }

  function renderStudyProgress() {
    const visibleCards = getVisibleFlashcards();
    const reviewed = state.sessionReviewedIds.length;
    const target = getSessionTargetCount();
    const accuracy = Math.round((state.sessionCorrect / Math.max(1, state.sessionAttempts)) * 100);

    elements.studyProgress.innerHTML = [
      createMetricCard(`${reviewed}/${target}`, "Session progress"),
      createMetricCard(`${visibleCards.length}`, "Cards in current deck scope"),
      createMetricCard(`${accuracy}%`, "Session accuracy"),
    ].join("");
  }

  function renderFlashcard() {
    const currentCard = getCurrentCard();

    if (!state.targetLanguage) {
      elements.cardFrontText.textContent = "Set a target language.";
      elements.cardFrontMeta.textContent = "This applies to the whole app, not just flashcards.";
      elements.cardBackText.textContent = "Once a language is set, you can study, practice, and track progress.";
      elements.cardBackMeta.textContent = "";
      elements.playAudio.disabled = true;
      elements.card.classList.remove("is-flipped");
      elements.card.disabled = true;
      return;
    }

    if (!currentCard) {
      elements.cardFrontText.textContent = `No flashcards for ${state.targetLanguage} yet.`;
      elements.cardFrontMeta.textContent = "Add cards in Settings and come back to start an immersive session.";
      elements.cardBackText.textContent = "Statistics will appear after you start practicing.";
      elements.cardBackMeta.textContent = "";
      elements.playAudio.disabled = true;
      elements.card.classList.remove("is-flipped");
      elements.card.disabled = true;
      return;
    }

    const studyContent = getCardStudyContent(currentCard);

    elements.cardFrontText.innerHTML = renderHighlightedText(studyContent.prompt);
    elements.cardFrontMeta.textContent = `${currentCard.deck}${studyContent.hint ? `\n${studyContent.hint}` : ""}`;
    elements.cardBackText.innerHTML = renderHighlightedText(studyContent.answer);
    elements.cardBackMeta.textContent = [
      currentCard.notes,
      `Practiced: ${currentCard.stats.attempts} times`,
      `Accuracy: ${getAccuracy(currentCard)}%`,
      currentCard.audio ? "Audio file attached" : "",
    ]
      .filter(Boolean)
      .join("\n");
    elements.playAudio.disabled = !currentCard.audio && !stripAnnotationMarkup(studyContent.prompt).trim();
    elements.card.disabled = state.isAdvancing || state.studyMode !== "flashcards";
    elements.card.classList.toggle("is-flipped", state.flipped);
  }

  function renderSessionEnd() {
    elements.studySessionContent.classList.toggle("hidden", state.sessionComplete);
    elements.sessionEndScreen.classList.toggle("hidden", !state.sessionComplete);
    if (!state.sessionComplete) {
      return;
    }

    const accuracy = Math.round((state.sessionCorrect / Math.max(1, state.sessionAttempts)) * 100);
    const reviewedCards = getVisibleFlashcards().filter((card) => state.sessionReviewedIds.includes(card.id));
    const knownCards = reviewedCards.filter(isKnownCard).length;

    elements.sessionEndTitle.textContent =
      state.sessionCompletionReason === "deck"
        ? "You reached the end of this deck."
        : "You reached your session goal.";
    elements.sessionEndStats.innerHTML = [
      createMetricCard(state.sessionReviewedIds.length, "Cards reviewed"),
      createMetricCard(`${accuracy}%`, "Session accuracy"),
      createMetricCard(knownCards, "Known cards in this run"),
    ].join("");
    elements.sessionEndSummary.innerHTML = reviewedCards.length
      ? reviewedCards
          .slice(0, 5)
          .map(
            (card) => `
              <div class="mini-row">
                <strong>${renderHighlightedText(card.prompt)}</strong>
                <span>${card.deck} · ${getAccuracy(card)}% correct overall · ${card.stats.attempts} total practices</span>
              </div>
            `,
          )
          .join("")
      : `<p class="list-meta">No cards were reviewed in this session.</p>`;
  }

  function renderFlashcardList() {
    const deckCards = getCardsForSettingsDeck();
    elements.cardCount.textContent = state.selectedSettingsDeck ? `${deckCards.length} cards` : "0 cards";
    elements.cardList.innerHTML = "";

    if (!state.targetLanguage) {
      elements.cardList.innerHTML = `<li class="list-meta">Select a target language to manage decks.</li>`;
      return;
    }

    if (!state.selectedSettingsDeck) {
      elements.cardList.innerHTML = `<li class="list-meta">Create or select a deck to view its cards.</li>`;
      return;
    }

    if (deckCards.length === 0) {
      elements.cardList.innerHTML = `<li class="list-meta">This deck does not contain any cards yet.</li>`;
      return;
    }

    deckCards
      .slice()
      .sort((left, right) => left.prompt.localeCompare(right.prompt))
      .forEach((card) => {
        const item = elements.template.content.firstElementChild.cloneNode(true);
        item.querySelector(".list-title").innerHTML = `${renderHighlightedText(card.prompt)} <span class="list-arrow">-></span> ${renderHighlightedText(card.answer)}`;
        item.querySelector(".list-meta").textContent =
          `${card.deck} · ${card.stats.attempts} practices · ${getAccuracy(card)}% correct` +
          (card.audio ? " · audio" : "");
        item.querySelector(".edit-card").addEventListener("click", () => {
          state.selectedSettingsDeck = card.deck;
          startEditingCard(card.id);
          renderCardFormState();
        });
        const playButton = item.querySelector(".play-list-audio");
        playButton.disabled = !card.audio;
        playButton.addEventListener("click", () => playAudioSource(card.audio));
        item.querySelector(".delete-card").addEventListener("click", () => deleteCard(card.id));
        elements.cardList.append(item);
      });
  }

  function buildMultipleChoiceOptions(card) {
    const studyContent = getCardStudyContent(card);
    const targetUsesHighlights = getHighlightedTerms(studyContent.answer).length > 0;
    const pool = getVisibleFlashcards().filter((candidate) => {
      if (candidate.id === card.id) {
        return false;
      }

      if (!targetUsesHighlights) {
        return true;
      }

      return getHighlightedTerms(getCardStudyContent(candidate, studyContent.direction).answer).length > 0;
    });
    const distractors = pool
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((candidate) => getMultipleChoiceAnswerText(getCardStudyContent(candidate, studyContent.direction).answer));
    return [getMultipleChoiceAnswerText(studyContent.answer), ...distractors].slice(0, 4).sort(() => Math.random() - 0.5);
  }

  function renderStudyModeTabs() {
    elements.studyModeTabs.forEach((tab) => {
      const isActive = tab.dataset.studyMode === state.studyMode;
      tab.classList.toggle("is-active", isActive);
    });
  }

  function renderTypingInputs(answerText) {
    const parts = getTypingClozeParts(answerText);
    const blankParts = parts.filter((part) => part.type === "blank");

    if (blankParts.length === 0) {
      elements.typingCloze.innerHTML = "";
      elements.typingCloze.classList.add("hidden");
      elements.typingAnswerLabel.classList.remove("hidden");
      return;
    }

    elements.typingCloze.innerHTML = parts
      .map((part, index) => {
        if (part.type === "blank") {
          return `<input class="typing-blank-input" type="text" data-blank-index="${index}" placeholder="" aria-label="Missing word" />`;
        }

        if (part.type === "grammar-link") {
          return `<span class="grammar-inline-link typing-cloze-text" role="link" tabindex="0" data-grammar-id="${escapeHtml(
            part.grammarId,
          )}">${escapeHtml(part.value)}</span>`;
        }

        return `<span class="typing-cloze-text">${escapeHtml(part.value)}</span>`;
      })
      .join("");
    elements.typingCloze.classList.remove("hidden");
    elements.typingAnswerLabel.classList.add("hidden");
  }

  function renderStatisticsViewTabs() {
    elements.statisticsViewTabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.statsView === state.statisticsView);
    });
  }

  function renderStudyMode() {
    const currentCard = getCurrentCard();
    const isFlashcards = state.studyMode === "flashcards";
    const isMultipleChoice = state.studyMode === "multiple-choice";
    const isTyping = state.studyMode === "typing";

    renderStudyModeTabs();
    elements.card.classList.toggle("hidden", !isFlashcards);
    elements.studyPractice.classList.toggle("hidden", isFlashcards);
    elements.multipleChoicePanel.classList.toggle("is-active", isMultipleChoice);
    elements.typingForm.classList.toggle("is-active", isTyping);
    elements.flipCard.classList.toggle("hidden", !isFlashcards);
    elements.markHard.parentElement.classList.toggle("hidden", !isFlashcards);
    elements.flipCard.disabled = !isFlashcards || state.sessionComplete || state.isAdvancing;
    elements.nextCard.disabled = state.sessionComplete || state.isAdvancing;
    elements.nextCard.textContent = isFlashcards ? "Skip" : "Next card";

    if (!state.targetLanguage) {
      elements.practicePrompt.textContent = "Set a target language first.";
      elements.practiceMeta.textContent = "The study modes will activate after you choose a language.";
      elements.practiceFeedback.textContent = "";
      elements.practiceFeedback.classList.add("is-empty");
      elements.multipleChoiceOptions.innerHTML = "";
      elements.playAudio.disabled = true;
      elements.typingCloze.innerHTML = "";
      elements.typingCloze.classList.add("hidden");
      elements.typingAnswerLabel.classList.remove("hidden");
      elements.typingAnswerInput.disabled = true;
      elements.typingForm.querySelector('button[type="submit"]').disabled = true;
      elements.acceptTypingAnswer.disabled = true;
      return;
    }

    if (!currentCard) {
      elements.practicePrompt.textContent = "No cards available for this deck.";
      elements.practiceMeta.textContent = "Add cards in Settings or switch decks.";
      elements.practiceFeedback.textContent = "";
      elements.practiceFeedback.classList.add("is-empty");
      elements.multipleChoiceOptions.innerHTML = "";
      elements.playAudio.disabled = true;
      elements.typingCloze.innerHTML = "";
      elements.typingCloze.classList.add("hidden");
      elements.typingAnswerLabel.classList.remove("hidden");
      elements.typingAnswerInput.disabled = true;
      elements.typingForm.querySelector('button[type="submit"]').disabled = true;
      elements.acceptTypingAnswer.disabled = true;
      return;
    }

    const studyContent = getCardStudyContent(currentCard);

    elements.practicePrompt.innerHTML = renderHighlightedText(studyContent.prompt);
    elements.practiceMeta.textContent = [currentCard.deck, studyContent.hint, `${getAccuracy(currentCard)}% correct`]
      .filter(Boolean)
      .join(" · ");
    elements.practiceFeedback.textContent = state.studyFeedback;
    elements.practiceFeedback.classList.toggle("is-empty", !state.studyFeedback || isFlashcards);
    elements.playAudio.disabled = !currentCard.audio && !stripAnnotationMarkup(studyContent.prompt).trim();

    if (isMultipleChoice) {
      const answered = state.studyAnsweredCardId === currentCard.id;
      const options = buildMultipleChoiceOptions(currentCard);
      elements.multipleChoiceOptions.innerHTML = options
        .map(
          (option) =>
            `<button class="option-button" type="button" data-answer="${option}" ${answered || state.isAdvancing || state.sessionComplete ? "disabled" : ""}>${option}</button>`,
        )
        .join("");

      [...elements.multipleChoiceOptions.querySelectorAll(".option-button")].forEach((button) => {
        button.addEventListener("click", () => {
          if (state.studyAnsweredCardId === currentCard.id || state.isAdvancing || state.sessionComplete) {
            return;
          }

          const isCorrect = normalizeText(button.dataset.answer) === normalizeText(getMultipleChoiceAnswerText(studyContent.answer));
          recordPractice(currentCard.id, isCorrect, "multiple-choice");
          registerSessionReview(currentCard.id, isCorrect);
          persistFlashcards();
          state.studyAnsweredCardId = currentCard.id;
          state.studyFeedback = isCorrect
            ? "Correct."
            : `Incorrect. Correct answer: ${stripAnnotationMarkup(studyContent.answer)}`;
          render();
        });
      });
    } else {
      elements.multipleChoiceOptions.innerHTML = "";
    }

    if (isTyping) {
      const hasHighlightedAnswer = getHighlightedTerms(studyContent.answer).length > 0;
      const submitButton = elements.typingForm.querySelector('button[type="submit"]');
      const answered = state.studyAnsweredCardId === currentCard.id;
      const canOverride = state.typingAnswerPendingCardId === currentCard.id;
      renderTypingInputs(studyContent.answer);
      elements.typingAnswerInput.disabled = answered || state.isAdvancing || state.sessionComplete;
      [...elements.typingCloze.querySelectorAll(".typing-blank-input")].forEach((input) => {
        input.disabled = answered || state.isAdvancing || state.sessionComplete;
      });
      submitButton.disabled = answered || state.isAdvancing || state.sessionComplete;
      elements.acceptTypingAnswer.disabled = !canOverride || state.isAdvancing;
    } else {
      elements.typingCloze.innerHTML = "";
      elements.typingCloze.classList.add("hidden");
      elements.typingAnswerLabel.classList.remove("hidden");
      elements.typingAnswerInput.disabled = false;
      elements.typingForm.querySelector('button[type="submit"]').disabled = false;
      elements.acceptTypingAnswer.disabled = true;
    }
  }

  function renderStatistics() {
    renderStatisticsViewTabs();
    const currentLanguageCards = getCardsForTargetLanguage();
    const studied = currentLanguageCards.filter((card) => card.stats.attempts > 0).length;
    const known = currentLanguageCards.filter(isKnownCard).length;
    const attempts = currentLanguageCards.reduce((sum, card) => sum + card.stats.attempts, 0);

    elements.languageSummaryStats.innerHTML = [
      createMetricCard(currentLanguageCards.length, "Total cards"),
      createMetricCard(studied, "Studied cards"),
      createMetricCard(known, "Known cards"),
      createMetricCard(attempts, "Practice attempts"),
    ].join("");

    const languageMastery = Math.round((known / Math.max(1, currentLanguageCards.length)) * 100);
    const languageRows = state.targetLanguage
      ? [
          {
            label: state.targetLanguage,
            valueLabel: `${known}/${currentLanguageCards.length} known`,
            percent: languageMastery,
          },
        ]
      : [];
    elements.languageChart.innerHTML =
      state.statisticsView === "charts"
        ? createBarChartRows(languageRows, "No language statistics yet.")
        : createTableRows(
            ["Language", "Known"],
            languageRows.map((row) => [row.label, row.valueLabel]),
            "No language statistics yet.",
          );

    const deckRows = getDecks().map((deck) => {
      const cards = currentLanguageCards.filter((card) => card.deck === deck);
      const knownCards = cards.filter(isKnownCard).length;
      const percent = Math.round((knownCards / Math.max(1, cards.length)) * 100);
      return {
        label: deck,
        valueLabel: `${percent}% known`,
        percent,
      };
    });
    elements.deckSummaryStats.innerHTML = [
      createMetricCard(getDecks().length, "Decks"),
      createMetricCard(`${languageMastery}%`, "Language mastery"),
      createMetricCard(
        `${Math.round(
          currentLanguageCards
            .filter((card) => card.stats.attempts > 0)
            .reduce((sum, card) => sum + getAccuracy(card), 0) / Math.max(1, studied),
        )}%`,
        "Average card accuracy",
      ),
    ].join("");
    elements.deckChart.innerHTML =
      state.statisticsView === "charts"
        ? createBarChartRows(deckRows, "No deck statistics yet.")
        : createTableRows(
            ["Deck", "Mastery"],
            deckRows.map((row) => [row.label, row.valueLabel]),
            "No deck statistics yet.",
          );

    const cardRows = currentLanguageCards
      .slice()
      .sort((left, right) => {
        if (left.stats.attempts === 0 && right.stats.attempts === 0) {
          return left.prompt.localeCompare(right.prompt);
        }
        return getAccuracy(right) - getAccuracy(left) || right.stats.attempts - left.stats.attempts;
      });

    elements.cardStatList.innerHTML =
      state.statisticsView === "charts"
        ? cardRows.length
          ? cardRows
              .map(
                (card) => `
                  <div class="mini-row">
                    <strong>${renderHighlightedText(card.prompt)}</strong>
                    <span>${card.deck} · ${card.stats.attempts} practices · ${getAccuracy(card)}% correct</span>
                  </div>
                `,
              )
              .join("")
          : `<p class="list-meta">No card statistics yet.</p>`
        : createTableRows(
            ["Card", "Performance"],
            cardRows.map((card) => [
              stripAnnotationMarkup(card.prompt),
              `${card.deck} · ${card.stats.attempts} practices · ${getAccuracy(card)}% correct`,
            ]),
            "No card statistics yet.",
          );
  }

  function renderLibrary() {
    const texts = getLibraryTextsForTargetLanguage();
    const activeText = getActiveLibraryText();
    const editingText = getEditingLibraryText();
    const unreadCount = texts.filter((entry) => entry.status === "unread").length;
    const readingCount = texts.filter((entry) => entry.status === "reading").length;
    const finishedCount = texts.filter((entry) => entry.status === "finished").length;

    elements.libraryCount.textContent = state.targetLanguage ? `${texts.length} texts` : "0 texts";
    elements.libraryCaptureBody.classList.toggle("hidden", state.libraryCaptureCollapsed);
    elements.toggleLibraryCapture.textContent = state.libraryCaptureCollapsed ? "Show" : "Hide";
    elements.libraryBrowserView.classList.toggle("hidden", state.libraryView !== "list");
    elements.libraryPageView.classList.toggle("hidden", state.libraryView !== "reader");
    elements.libraryEditorView.classList.toggle("hidden", state.libraryView !== "editor");
    elements.libraryBackToList.classList.toggle("hidden", state.libraryView === "list");
    elements.editLibraryText.classList.toggle("hidden", state.libraryView !== "reader" || !activeText);

    if (!state.targetLanguage) {
      elements.libraryPanelTitle.textContent = "Text library";
      elements.librarySummaryStats.innerHTML = "";
      elements.libraryList.innerHTML = `<p class="list-meta">Select a target language to build a reading library.</p>`;
      elements.libraryReaderMeta.innerHTML = "";
      elements.libraryReaderContent.innerHTML = `<p class="list-meta">Import or select a text to start reading.</p>`;
      elements.libraryDeckSelect.innerHTML = `<option value="">No decks available</option>`;
      elements.libraryCardForm.reset();
      elements.librarySnippetInput.disabled = true;
      elements.libraryReadingProgress.classList.add("hidden");
      elements.libraryReaderActions.classList.add("hidden");
      elements.libraryEditorView.classList.add("hidden");
      elements.editLibraryText.classList.add("hidden");
      elements.deleteLibraryText.classList.add("hidden");
      return;
    }

    const libraryDecks = getDecks();
    elements.libraryDeckSelect.innerHTML = libraryDecks.length
      ? libraryDecks.map((deck) => `<option value="${escapeHtml(deck)}">${escapeHtml(deck)}</option>`).join("")
      : `<option value="">No decks yet</option>`;
    elements.librarySnippetInput.value = state.selectedLibrarySnippet;
    elements.librarySnippetInput.disabled = false;
    elements.librarySelectionStatus.textContent = state.selectedLibrarySnippet
      ? "Selection captured. You can adjust it before saving."
      : "Select a word or sentence in the text, then use it here.";

    elements.librarySummaryStats.innerHTML = [
      createMetricCard(texts.length, "Texts"),
      createMetricCard(readingCount, "Currently reading"),
      createMetricCard(finishedCount, "Finished"),
    ].join("");

    elements.libraryList.innerHTML = texts.length
      ? texts
          .slice()
          .sort((left, right) => left.title.localeCompare(right.title))
          .map(
            (entry) => `
              <article class="library-list-item${entry.id === state.activeLibraryTextId ? " is-active" : ""}" tabindex="0" data-library-id="${entry.id}">
                <div>
                  <strong>${escapeHtml(entry.title)}</strong>
                  <p>${escapeHtml(entry.detectedLanguage || entry.language)} · ${escapeHtml(entry.difficulty)} · ${entry.progress}% read</p>
                  ${renderTagChips(entry.tags)}
                </div>
                <span class="library-state state-${entry.status}">${escapeHtml(entry.status)}</span>
              </article>
            `,
          )
          .join("")
      : `<p class="list-meta">No texts yet for ${state.targetLanguage}. Import one to start building the library.</p>`;

    [...elements.libraryList.querySelectorAll("[data-library-id]")].forEach((item) => {
      const openEntry = () => {
        state.activeLibraryTextId = item.dataset.libraryId;
        state.libraryView = "reader";
        renderLibrary();
      };

      item.addEventListener("click", openEntry);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openEntry();
        }
      });
    });

    if (!activeText) {
      elements.libraryPanelTitle.textContent = "Text library";
      elements.libraryReaderMeta.innerHTML = `<p class="list-meta">No imported texts yet.</p>`;
      elements.libraryReaderContent.innerHTML = `<p class="list-meta">Import a text to start reading.</p>`;
      elements.libraryReadingProgress.classList.add("hidden");
      elements.libraryReaderActions.classList.add("hidden");
      elements.deleteLibraryText.classList.add("hidden");
      elements.editLibraryText.classList.add("hidden");
      return;
    }

    if (state.libraryView === "editor" && editingText) {
      elements.libraryPanelTitle.textContent = `Edit ${editingText.title}`;
      elements.libraryReaderMeta.innerHTML = "";
      elements.libraryReadingProgress.classList.add("hidden");
      elements.libraryReaderActions.classList.add("hidden");
      elements.deleteLibraryText.classList.remove("hidden");
      elements.editLibraryText.classList.add("hidden");
      return;
    }

    const chunks = splitTextIntoReadingChunks(activeText.text);
    const safeChunkIndex = Math.min(activeText.currentChunk, Math.max(0, chunks.length - 1));
    const currentChunk = chunks[safeChunkIndex] || "";
    const progressPercent =
      chunks.length <= 1 ? Math.max(activeText.progress, activeText.status === "finished" ? 100 : 0) : Math.round((safeChunkIndex / Math.max(1, chunks.length - 1)) * 100);

    if (state.libraryView !== "reader") {
      elements.libraryPanelTitle.textContent = "Text library";
      elements.libraryReaderMeta.innerHTML = "";
      elements.libraryReaderContent.innerHTML = `<p class="list-meta">Select a text from the list to start reading it.</p>`;
      elements.libraryReadingProgress.classList.add("hidden");
      elements.libraryReaderActions.classList.add("hidden");
      elements.deleteLibraryText.classList.add("hidden");
      elements.editLibraryText.classList.add("hidden");
      return;
    }

    elements.libraryPanelTitle.textContent = activeText.title;
    elements.libraryReaderMeta.innerHTML = [
      createMetricCard(activeText.wordCount, "Words"),
      createMetricCard(activeText.characterCount, "Characters"),
      createMetricCard(activeText.difficulty, "Difficulty"),
    ].join("");
    elements.libraryReadingProgress.innerHTML = [
      createMetricCard(`${safeChunkIndex + 1}/${Math.max(1, chunks.length)}`, "Reading section"),
      createMetricCard(`${progressPercent}%`, "Progress"),
      createMetricCard(activeText.status, "Status"),
    ].join("");
    elements.libraryReadingProgress.classList.remove("hidden");
    elements.libraryReaderContent.innerHTML = `
      <div class="library-reader-header">
        <p class="list-meta">${escapeHtml(activeText.sourceName || "Imported text")} · ${escapeHtml(activeText.detectedLanguage || activeText.language)}</p>
        ${renderTagChips(activeText.tags)}
      </div>
      <div class="library-text-body">${renderHighlightedMultilineText(currentChunk)}</div>
    `;
    elements.libraryReaderActions.classList.remove("hidden");
    elements.libraryPreviousChunk.disabled = safeChunkIndex === 0;
    elements.libraryNextChunk.textContent = safeChunkIndex >= chunks.length - 1 ? "Finish" : "Next";
    elements.deleteLibraryText.classList.remove("hidden");
  }

  function renderGrammar() {
    const points = getGrammarForTargetLanguage();
    const activePoint = getActiveGrammarPoint();

    elements.grammarCount.textContent = state.targetLanguage ? `${points.length} points` : "0 points";
    elements.grammarLibraryView.classList.toggle("hidden", state.grammarView !== "library");
    elements.grammarPageView.classList.toggle("hidden", state.grammarView !== "page");
    elements.grammarEditorView.classList.toggle("hidden", state.grammarView !== "editor");
    elements.grammarBackToLibrary.classList.toggle("hidden", state.grammarView === "library");
    elements.grammarEditCurrent.classList.toggle(
      "hidden",
      state.grammarView !== "page" || !activePoint,
    );

    if (!state.targetLanguage) {
      elements.grammarPanelTitle.textContent = "Grammar library";
      elements.grammarPage.innerHTML = `<p class="list-meta">Select a target language to start building grammar notes.</p>`;
      elements.grammarList.innerHTML = `<p class="list-meta">No language selected.</p>`;
      renderGrammarSectionsEditor();
      renderGrammarLinkSuggestions();
      return;
    }

    if (state.grammarView === "library") {
      elements.grammarPanelTitle.textContent = "Grammar library";
    } else if (state.grammarView === "editor") {
      elements.grammarPanelTitle.textContent = getEditingGrammarPoint() ? "Edit grammar point" : "New grammar point";
    } else {
      elements.grammarPanelTitle.textContent = activePoint?.title || "Grammar point";
    }

    elements.grammarList.innerHTML = points.length
      ? points
          .map(
            (point) => `
              <article class="grammar-list-item${point.id === state.activeGrammarId ? " is-active" : ""}" tabindex="0" data-grammar-id="${point.id}">
                <div>
                  <strong>${escapeHtml(point.title)}</strong>
                  <p>${escapeHtml(point.summary)}</p>
                </div>
                <div class="list-actions">
                  <button class="secondary edit-grammar" type="button" data-grammar-id="${point.id}">Edit</button>
                  <button class="ghost delete-grammar" type="button" data-grammar-id="${point.id}">Delete</button>
                </div>
              </article>
            `,
          )
          .join("")
      : `<p class="list-meta">No grammar points yet for ${state.targetLanguage}.</p>`;

    [...elements.grammarList.querySelectorAll(".grammar-list-item")].forEach((item) => {
      const openPoint = () => {
        state.activeGrammarId = item.dataset.grammarId;
        state.grammarView = "page";
        renderGrammar();
      };

      item.addEventListener("click", (event) => {
        if (event.target.closest(".edit-grammar") || event.target.closest(".delete-grammar")) {
          return;
        }
        openPoint();
      });
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPoint();
        }
      });
    });

    [...elements.grammarList.querySelectorAll(".edit-grammar")].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        startEditingGrammarPoint(button.dataset.grammarId);
        renderGrammarFormState();
        renderGrammarSectionsEditor();
        renderGrammar();
      });
    });

    [...elements.grammarList.querySelectorAll(".delete-grammar")].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteGrammarPoint(button.dataset.grammarId);
      });
    });

    if (!activePoint) {
      elements.grammarPage.innerHTML = `<p class="list-meta">Create your first grammar point for ${state.targetLanguage}.</p>`;
      renderGrammarSectionsEditor();
      return;
    }

    const renderGrammarBlockHtml = (block, depth = 0) => {
      const childHtml = block.children?.length
        ? `<div class="grammar-subsections depth-${depth + 1}">${block.children
            .map((child) => renderGrammarBlockHtml(child, depth + 1))
            .join("")}</div>`
        : "";

      if (block.type === "video") {
        const embedUrl = extractYouTubeEmbedUrl(block.content);
        return `
          <section class="grammar-section depth-${depth}">
            <h4>${escapeHtml(block.title || "Video")}</h4>
            ${
              embedUrl
                ? `<div class="video-embed-wrap"><iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(block.title || "Grammar video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`
                : `<p class="list-meta">Invalid YouTube link.</p>`
            }
            ${childHtml}
          </section>
        `;
      }

      if (block.type === "examples") {
        const items = parseTextareaList(block.content);
        return `
          <section class="grammar-section depth-${depth}">
            <h4>${escapeHtml(block.title || "Examples")}</h4>
            ${
              items.length
                ? `<ul class="grammar-bullets">${items.map((item) => `<li>${renderHighlightedMultilineText(item)}</li>`).join("")}</ul>`
                : `<p class="list-meta">No examples yet.</p>`
            }
            ${childHtml}
          </section>
        `;
      }

      if (block.type === "exercises") {
        const items = parseTextareaList(block.content);
        return `
          <section class="grammar-section depth-${depth}">
            <h4>${escapeHtml(block.title || "Exercises")}</h4>
            ${
              items.length
                ? `<ol class="grammar-bullets">${items.map((item) => `<li>${renderHighlightedMultilineText(item)}</li>`).join("")}</ol>`
                : `<p class="list-meta">No exercises yet.</p>`
            }
            ${childHtml}
          </section>
        `;
      }

      return `
        <section class="grammar-section depth-${depth}">
          <h4>${escapeHtml(block.title || "Section")}</h4>
          <p>${renderHighlightedMultilineText(block.content)}</p>
          ${childHtml}
        </section>
      `;
    };

    elements.grammarPage.innerHTML = `
      <div class="grammar-hero">
        <p class="panel-kicker">Grammar point</p>
        <h3>${escapeHtml(activePoint.title)}</h3>
        <p class="grammar-summary">${escapeHtml(activePoint.summary)}</p>
      </div>
      ${
        activePoint.blocks.length
          ? activePoint.blocks.map((block) => renderGrammarBlockHtml(block)).join("")
          : `<section class="grammar-section"><p class="list-meta">This grammar page does not have any sections yet.</p></section>`
      }
    `;

    renderGrammarSectionsEditor();
    renderGrammarLinkSuggestions();
  }

  function renderDeckSummary() {
    const decks = getDecks();
    elements.deckCount.textContent = state.targetLanguage ? `${decks.length} decks` : "0 decks";

    if (!state.targetLanguage) {
      elements.deckSummary.innerHTML = `<p class="list-meta">Select a target language to manage its decks.</p>`;
      elements.settingsDeckTitle.textContent = "Deck workspace";
      elements.selectedDeckMeta.textContent = "Select a deck to manage its cards.";
      elements.renameSelectedDeckForm.classList.add("hidden");
      elements.deleteSelectedDeck.classList.add("hidden");
      return;
    }

    if (decks.length === 0) {
      elements.deckSummary.innerHTML = `<p class="list-meta">No decks exist yet for ${state.targetLanguage}. Add cards below to create one.</p>`;
      elements.settingsDeckTitle.textContent = "Deck workspace";
      elements.selectedDeckMeta.textContent = "Create a deck to start adding cards.";
      elements.renameSelectedDeckForm.classList.add("hidden");
      elements.deleteSelectedDeck.classList.add("hidden");
      return;
    }

    elements.deckSummary.innerHTML = `
      <div class="deck-table settings-deck-list">
        ${decks
          .map((deck) => {
            const cards = getCardsForTargetLanguage().filter((card) => card.deck === deck);
            const studied = cards.filter((card) => card.stats.attempts > 0).length;
            const known = cards.filter(isKnownCard).length;
            return `
              <button class="deck-table-row settings-deck-row${deck === state.selectedSettingsDeck ? " is-active" : ""}" type="button" data-settings-deck="${deck}">
                <span>${deck}</span>
                <span>${cards.length} cards</span>
                <span>${studied} studied</span>
                <span>${known} known</span>
              </button>
            `;
          })
          .join("")}
      </div>
    `;

    [...elements.deckSummary.querySelectorAll("[data-settings-deck]")].forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedSettingsDeck = button.dataset.settingsDeck;
        stopEditingCard();
        render();
      });
    });

    elements.settingsDeckTitle.textContent = state.selectedSettingsDeck || "Deck workspace";
    elements.selectedDeckMeta.textContent = state.selectedSettingsDeck
      ? `${getCardsForSettingsDeck().length} cards in this deck.`
      : "Select a deck to manage its cards.";
    elements.renameSelectedDeckForm.classList.toggle("hidden", !state.selectedSettingsDeck);
    elements.deleteSelectedDeck.classList.toggle("hidden", !state.selectedSettingsDeck);
    elements.renameSelectedDeckInput.value = state.selectedSettingsDeck || "";
  }

  function attachGrammarLinkNavigation(element) {
    const activate = (target) => {
      const link = target.closest(".grammar-inline-link");
      if (!link) {
        return false;
      }

      openGrammarPointByReference(link.dataset.grammarId || "");
      return true;
    };

    element.addEventListener("click", (event) => {
      if (activate(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    element.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && activate(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
  }

  function insertTextAtCursor(field, text) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.value = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
    const nextPosition = start + text.length;
    field.focus();
    field.setSelectionRange(nextPosition, nextPosition);
  }

  function render() {
    renderHeroStats();
    renderLanguageTabs();
    renderTabs();
    renderDecks();
    renderCardFormState();
    renderGrammarFormState();
    renderStudyProgress();
    renderFlashcard();
    renderStudyMode();
    renderSessionEnd();
    renderFlashcardList();
    renderLibrary();
    renderGrammar();
    renderStatistics();
    renderDeckSummary();
    syncAudioImportUi();
  }

  function advanceStudyCard() {
    const visibleCards = getVisibleFlashcards();
    if (visibleCards.length === 0 || state.sessionComplete || state.isAdvancing) {
      return;
    }

    finalizePendingTypingReview(false);
    if (state.sessionComplete) {
      clearStudyAnswerState();
      render();
      return;
    }
    cancelPendingAdvance();
    clearStudyAnswerState();

    const nextIndex = (state.currentIndex + 1) % visibleCards.length;
    if (state.studyMode === "flashcards" && state.flipped) {
      state.isAdvancing = true;
      state.flipped = false;
      renderFlashcard();
      renderStudyMode();
      state.advanceTimeoutId = window.setTimeout(() => {
        state.advanceTimeoutId = 0;
        state.currentIndex = nextIndex;
        state.isAdvancing = false;
        render();
      }, 240);
      return;
    }

    state.currentIndex = nextIndex;
    state.flipped = false;
    render();
  }

  function updateFlashcardScore(nextScore, isCorrect) {
    const currentCard = getCurrentCard();
    if (!currentCard || state.sessionComplete) {
      return;
    }

    const targetCard = state.flashcards.find((card) => card.id === currentCard.id);
    targetCard.score = nextScore;
    recordPractice(currentCard.id, isCorrect, "flashcard");
    registerSessionReview(currentCard.id, isCorrect);
    persistFlashcards();
    if (!state.sessionComplete) {
      advanceStudyCard();
    } else {
      render();
    }
  }

  function deleteCard(id) {
    const card = state.flashcards.find((entry) => entry.id === id);
    const cardLabel = card ? stripAnnotationMarkup(card.prompt) : "this card";
    if (!window.confirm(`Delete ${cardLabel}? This cannot be undone.`)) {
      return;
    }

    state.flashcards = state.flashcards.filter((card) => card.id !== id);
    persistFlashcards();
    if (state.editingCardId === id) {
      stopEditingCard();
    }
    resetSession();
    render();
  }

  function deleteGrammarPoint(id) {
    const point = state.grammarPoints.find((entry) => entry.id === id);
    const pointLabel = point?.title || "this grammar point";
    if (!window.confirm(`Delete ${pointLabel}? This cannot be undone.`)) {
      return;
    }

    state.grammarPoints = state.grammarPoints.filter((point) => point.id !== id);
    persistGrammarPoints();
    if (state.activeGrammarId === id) {
      state.activeGrammarId = "";
    }
    if (state.editingGrammarId === id) {
      stopEditingGrammarPoint();
    }
    if (state.grammarView === "page" && state.activeGrammarId === "") {
      state.grammarView = "library";
    }
    render();
  }

  function renameDeck(sourceDeck, nextDeck) {
    ensureCustomDeck(state.targetLanguage, nextDeck);
    state.settings.customDecks = state.settings.customDecks.map((deck) =>
      deck.language === state.targetLanguage && deck.name === sourceDeck ? { ...deck, name: nextDeck } : deck,
    );
    state.flashcards = state.flashcards.map((card) =>
      card.language === state.targetLanguage && card.deck === sourceDeck ? { ...card, deck: nextDeck } : card,
    );
    persistFlashcards();
    persistSettings();
    state.selectedSettingsDeck = nextDeck;
    resetSession();
  }

  function deleteDeck(deck) {
    if (!window.confirm(`Delete the deck ${deck} and all of its cards? This cannot be undone.`)) {
      return;
    }

    if (getEditingCard()?.deck === deck) {
      stopEditingCard();
    }
    removeCustomDeck(state.targetLanguage, deck);
    state.flashcards = state.flashcards.filter(
      (card) => !(card.language === state.targetLanguage && card.deck === deck),
    );
    persistFlashcards();
    persistSettings();
    if (state.activeDeck === deck) {
      state.activeDeck = ALL_DECKS;
    }
    if (state.selectedSettingsDeck === deck) {
      state.selectedSettingsDeck = "";
    }
    resetSession();
  }

  function deleteLibraryText(id) {
    const entry = state.libraryTexts.find((item) => item.id === id);
    const label = entry?.title || "this text";
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
      return;
    }

    state.libraryTexts = state.libraryTexts.filter((item) => item.id !== id);
    if (state.activeLibraryTextId === id) {
      state.activeLibraryTextId = "";
    }
    if (state.editingLibraryTextId === id) {
      stopEditingLibraryText();
    }
    persistLibraryTexts();
    render();
  }

  function applyImportedData(bundle) {
    cancelPendingAdvance();
    stopEditingCard();
    stopEditingGrammarPoint();
    stopEditingLibraryText();

    state.settings = bundle.settings;
    state.flashcards = bundle.flashcards;
    state.grammarPoints = bundle.grammarPoints;
    state.libraryTexts = bundle.libraryTexts;
    state.targetLanguage = state.settings.targetLanguage;
    state.activeDeck = ALL_DECKS;
    state.activeGrammarId = "";
    state.activeLibraryTextId = "";
    state.selectedSettingsDeck = "";
    state.libraryView = "list";
    state.selectedLibrarySnippet = "";
    state.libraryCaptureCollapsed = false;
    resetSession();

    persistSettings();
    persistFlashcards();
    persistGrammarPoints();
    persistLibraryTexts();
  }

  function updateLibraryReadingPosition(textId, nextChunk) {
    const targetText = state.libraryTexts.find((entry) => entry.id === textId);
    if (!targetText) {
      return;
    }

    const chunks = splitTextIntoReadingChunks(targetText.text);
    const maxIndex = Math.max(0, chunks.length - 1);
    const safeChunk = Math.max(0, Math.min(nextChunk, maxIndex));
    const isFinished = chunks.length === 0 ? true : safeChunk >= maxIndex && nextChunk > maxIndex;
    const progress = isFinished
      ? 100
      : chunks.length <= 1
        ? 0
        : Math.round((safeChunk / chunks.length) * 100);
    const status = progress === 0 ? "unread" : isFinished ? "finished" : "reading";

    state.libraryTexts = state.libraryTexts.map((entry) =>
      entry.id === textId
        ? {
            ...entry,
            currentChunk: Math.min(safeChunk, maxIndex),
            progress,
            status,
          }
        : entry,
    );
    persistLibraryTexts();
  }

  elements.addLanguageToggle.addEventListener("click", () => {
    elements.addLanguageForm.classList.toggle("is-open");
    if (elements.addLanguageForm.classList.contains("is-open")) {
      elements.targetLanguageInput.focus();
    }
  });

  elements.addLanguageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextLanguage = new FormData(event.currentTarget).get("targetLanguage").toString().trim();
    if (!nextLanguage) {
      return;
    }

    if (!state.settings.customLanguages.includes(nextLanguage)) {
      state.settings.customLanguages = [...state.settings.customLanguages, nextLanguage];
    }

    setTargetLanguage(nextLanguage);
    elements.addLanguageForm.reset();
    elements.addLanguageForm.classList.remove("is-open");
    render();
  });

  elements.exportAppData.addEventListener("click", () => {
    const bundle = buildExportBundle(state);
    const file = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const timestamp = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kapp-data-${timestamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    elements.dataTransferStatus.textContent = "Data exported as a JSON bundle.";
  });

  elements.importAppDataForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = elements.importAppDataFile.files?.[0];
    if (!file) {
      return;
    }

    if (!window.confirm("Importing will replace the local app data on this device. Continue?")) {
      return;
    }

    elements.importAppDataButton.disabled = true;
    try {
      const parsed = JSON.parse(await file.text());
      const hydrated = hydrateImportBundle(parsed);
      applyImportedData(hydrated);
      elements.importAppDataForm.reset();
      elements.dataTransferStatus.textContent = "Data imported successfully.";
      render();
    } catch {
      elements.dataTransferStatus.textContent = "Import failed. Please use a valid Kapp JSON export.";
    } finally {
      elements.importAppDataButton.disabled = false;
    }
  });

  elements.featureTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      renderTabs();
    });
  });

  [
    elements.card,
    elements.practicePrompt,
    elements.typingCloze,
    elements.cardList,
    elements.sessionEndSummary,
    elements.cardStatList,
    elements.libraryReaderContent,
    elements.grammarPage,
  ].forEach(attachGrammarLinkNavigation);

  elements.studyModeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      cancelPendingAdvance();
      state.studyMode = tab.dataset.studyMode;
      state.flipped = false;
      clearStudyAnswerState();
      render();
    });
  });

  elements.statisticsViewTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.statisticsView = tab.dataset.statsView;
      renderStatistics();
    });
  });

  elements.deckFilter.addEventListener("change", (event) => {
    state.activeDeck = event.target.value;
    resetSession();
    render();
  });

  elements.sessionGoal.addEventListener("change", (event) => {
    state.sessionGoal = Number(event.target.value);
    resetSession();
    render();
  });

  elements.restartSession.addEventListener("click", () => {
    resetSession();
    render();
  });

  elements.startNextSession.addEventListener("click", () => {
    resetSession();
    render();
  });

  elements.typingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const currentCard = getCurrentCard();
    if (!currentCard || state.studyAnsweredCardId === currentCard.id || state.isAdvancing || state.sessionComplete) {
      return;
    }

    const studyContent = getCardStudyContent(currentCard);
    const expectedHighlights = getHighlightedTerms(studyContent.answer);
    const typedBlankInputs = [...elements.typingCloze.querySelectorAll(".typing-blank-input")];
    const expectedAnswer = getTypingAnswerText(studyContent.answer);
    const typedAnswer =
      expectedHighlights.length > 0
        ? typedBlankInputs.map((input) => input.value).join(" ")
        : new FormData(event.currentTarget).get("typingAnswer").toString();
    const isCorrect =
      expectedHighlights.length > 0
        ? expectedHighlights.length === typedBlankInputs.length &&
          expectedHighlights.every((answer, index) => normalizeText(typedBlankInputs[index].value) === normalizeText(answer))
        : normalizeText(typedAnswer) === normalizeText(expectedAnswer);
    recordPractice(currentCard.id, isCorrect, "typing");
    if (isCorrect) {
      registerSessionReview(currentCard.id, true);
    } else {
      state.pendingTypingReviewCardId = currentCard.id;
    }
    persistFlashcards();
    state.studyAnsweredCardId = currentCard.id;
    state.studyFeedback = isCorrect ? "Correct." : `Incorrect. Correct answer: ${expectedAnswer}`;
    state.typingAnswerPendingCardId = isCorrect ? "" : currentCard.id;
    event.currentTarget.reset();
    render();
  });

  elements.acceptTypingAnswer.addEventListener("click", () => {
    const currentCard = getCurrentCard();
    if (!currentCard || state.typingAnswerPendingCardId !== currentCard.id) {
      return;
    }

    const targetCard = state.flashcards.find((card) => card.id === currentCard.id);
    if (!targetCard) {
      return;
    }

    targetCard.stats.correct += 1;
    finalizePendingTypingReview(true);
    persistFlashcards();
    state.studyFeedback = "Accepted as correct.";
    state.typingAnswerPendingCardId = "";
    render();
  });

  elements.audioFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      clearImportedAudio();
      return;
    }

    state.importedAudio = await fileToDataUrl(file);
    syncAudioImportUi();
  });

  elements.playRecording.addEventListener("click", () => playAudioSource(state.importedAudio));
  elements.clearRecording.addEventListener("click", clearImportedAudio);
  elements.cancelEditCard.addEventListener("click", () => {
    stopEditingCard();
    renderCardFormState();
  });
  elements.cancelEditGrammar.addEventListener("click", () => {
    stopEditingGrammarPoint();
    state.grammarView = state.activeGrammarId ? "page" : "library";
    renderGrammarFormState();
    renderGrammarSectionsEditor();
    renderGrammar();
  });
  elements.createDeckForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.targetLanguage) {
      return;
    }

    const deckName = new FormData(event.currentTarget).get("deckName").toString().trim();
    if (!deckName) {
      return;
    }

    ensureCustomDeck(state.targetLanguage, deckName);
    persistSettings();
    state.selectedSettingsDeck = deckName;
    event.currentTarget.reset();
    render();
  });
  elements.libraryBackToList.addEventListener("click", () => {
    stopEditingLibraryText();
    state.libraryView = "list";
    render();
  });
  elements.editLibraryText.addEventListener("click", () => {
    const activeText = getActiveLibraryText();
    if (!activeText) {
      return;
    }

    startEditingLibraryText(activeText.id);
    render();
  });
  elements.cancelEditLibraryText.addEventListener("click", () => {
    stopEditingLibraryText();
    state.libraryView = state.activeLibraryTextId ? "reader" : "list";
    render();
  });
  elements.libraryEditTextInput.addEventListener("input", () => {
    renderLibraryGrammarSuggestions();
  });
  elements.libraryEditTextInput.addEventListener("click", () => {
    renderLibraryGrammarSuggestions();
  });
  elements.libraryEditTextInput.addEventListener("keyup", () => {
    renderLibraryGrammarSuggestions();
  });
  elements.libraryPreviousChunk.addEventListener("click", () => {
    const activeText = getActiveLibraryText();
    if (!activeText) {
      return;
    }

    updateLibraryReadingPosition(activeText.id, activeText.currentChunk - 1);
    render();
  });
  elements.libraryUseSelection.addEventListener("click", () => {
    const selectedText = window.getSelection?.().toString().trim() || "";
    if (!selectedText) {
      elements.librarySelectionStatus.textContent = "No text selected. Highlight a word or sentence first.";
      return;
    }

    state.selectedLibrarySnippet = selectedText;
    elements.librarySnippetInput.value = selectedText;
    elements.librarySelectionStatus.textContent = "Selection captured. You can adjust it before saving.";
  });
  elements.toggleLibraryCapture.addEventListener("click", () => {
    state.libraryCaptureCollapsed = !state.libraryCaptureCollapsed;
    renderLibrary();
  });
  elements.libraryNextChunk.addEventListener("click", () => {
    const activeText = getActiveLibraryText();
    if (!activeText) {
      return;
    }

    const chunks = splitTextIntoReadingChunks(activeText.text);
    const isLastChunk = activeText.currentChunk >= Math.max(0, chunks.length - 1);
    updateLibraryReadingPosition(activeText.id, activeText.currentChunk + 1);
    if (isLastChunk) {
      state.libraryView = "list";
    }
    render();
  });
  elements.libraryCardForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.targetLanguage) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const newDeckName = formData.get("newDeckName").toString().trim();
    const selectedDeck = formData.get("deckName").toString().trim();
    const deckName = newDeckName || selectedDeck;
    const prompt = formData.get("prompt").toString().trim();
    const answer = formData.get("answer").toString().trim();

    if (!deckName || !prompt || !answer) {
      return;
    }

    ensureCustomDeck(state.targetLanguage, deckName);
    const nextCard = hydrateCard({
      id: generateId(),
      language: state.targetLanguage,
      deck: deckName,
      prompt,
      hint: formData.get("hint").toString().trim(),
      answer,
      notes: formData.get("notes").toString().trim(),
      audio: "",
      score: 0,
      stats: createEmptyStats(),
    });

    state.flashcards = [nextCard, ...state.flashcards];
    state.selectedLibrarySnippet = prompt;
    persistFlashcards();
    persistSettings();
    event.currentTarget.reset();
    state.selectedLibrarySnippet = "";
    elements.librarySelectionStatus.textContent = `Added to deck ${deckName}.`;
    render();
  });
  elements.deleteLibraryText.addEventListener("click", () => {
    const activeText = getActiveLibraryText();
    if (!activeText) {
      return;
    }

    deleteLibraryText(activeText.id);
  });
  elements.renameSelectedDeckForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.selectedSettingsDeck) {
      return;
    }

    const nextDeck = new FormData(event.currentTarget).get("nextDeck").toString().trim();
    if (!nextDeck) {
      return;
    }

    renameDeck(state.selectedSettingsDeck, nextDeck);
    render();
  });
  elements.deleteSelectedDeck.addEventListener("click", () => {
    if (!state.selectedSettingsDeck) {
      return;
    }

    deleteDeck(state.selectedSettingsDeck);
    render();
  });
  elements.grammarBackToLibrary.addEventListener("click", () => {
    stopEditingGrammarPoint();
    state.grammarView = "library";
    render();
  });
  elements.grammarCreateNew.addEventListener("click", () => {
    stopEditingGrammarPoint();
    state.grammarView = "editor";
    state.draftGrammarSections = [createGrammarBlock("text")];
    render();
  });
  elements.insertGrammarLink.addEventListener("click", () => {
    const targetName = elements.grammarLinkTarget.value;
    const visibleText = elements.grammarLinkText.value.trim();
    const grammarId = elements.grammarLinkSelect.value;
    const targetField = elements.form.elements[targetName];

    if (!targetField || !visibleText || !grammarId) {
      return;
    }

    insertTextAtCursor(targetField, `{{${visibleText}::${grammarId}}}`);
    elements.grammarLinkText.value = "";
    elements.grammarLinkSelect.value = "";
  });
  elements.grammarEditCurrent.addEventListener("click", () => {
    if (!state.activeGrammarId) {
      return;
    }
    startEditingGrammarPoint(state.activeGrammarId);
    render();
  });
  elements.addTextSection.addEventListener("click", () => {
    state.draftGrammarSections = [...state.draftGrammarSections, createGrammarBlock("text")];
    renderGrammarSectionsEditor();
  });
  elements.addExampleSection.addEventListener("click", () => {
    state.draftGrammarSections = [...state.draftGrammarSections, createGrammarBlock("examples")];
    renderGrammarSectionsEditor();
  });
  elements.addExerciseSection.addEventListener("click", () => {
    state.draftGrammarSections = [...state.draftGrammarSections, createGrammarBlock("exercises")];
    renderGrammarSectionsEditor();
  });
  elements.addVideoSection.addEventListener("click", () => {
    state.draftGrammarSections = [...state.draftGrammarSections, createGrammarBlock("video")];
    renderGrammarSectionsEditor();
  });
  elements.libraryImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.targetLanguage) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const file = elements.libraryFileInput.files?.[0] || null;
    let importedText = formData.get("text").toString();
    elements.libraryImportStatus.textContent = "Importing text...";
    elements.saveLibraryTextButton.disabled = true;

    try {
      if (file) {
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          importedText = extractPdfTextFromBuffer(await file.arrayBuffer());
        } else {
          importedText = await file.text();
        }
      }

      const cleanedText = cleanImportedText(importedText);
      if (!cleanedText) {
        elements.libraryImportStatus.textContent = "No readable text found. Try a TXT file or paste text manually.";
        return;
      }

      const titleInput = formData.get("title").toString().trim();
      const title =
        titleInput ||
        file?.name.replace(/\.[^.]+$/, "") ||
        cleanedText.split(/\n/)[0].slice(0, 60) ||
        "Imported text";
      const wordCount = (cleanedText.match(/[^\s]+/g) || []).length;
      const selectedDifficulty = formData.get("difficulty").toString().trim();
      const nextEntry = hydrateLibraryText({
        id: generateId(),
        language: state.targetLanguage,
        title,
        text: cleanedText,
        tags: parseTags(formData.get("tags").toString()),
        sourceName: file?.name || "Pasted text",
        sourceType: file?.type || "text/plain",
        detectedLanguage: detectLanguageFromText(cleanedText, state.targetLanguage),
        difficulty: selectedDifficulty || estimateDifficulty(cleanedText),
        status: "unread",
        progress: 0,
        currentChunk: 0,
        wordCount,
        characterCount: cleanedText.length,
      });

      state.libraryTexts = [nextEntry, ...state.libraryTexts];
      state.activeLibraryTextId = nextEntry.id;
      state.libraryView = "list";
      persistLibraryTexts();
      event.currentTarget.reset();
      elements.libraryImportStatus.textContent = `Imported ${nextEntry.title}.`;
      render();
    } finally {
      elements.saveLibraryTextButton.disabled = false;
    }
  });
  elements.libraryEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const editingText = getEditingLibraryText();
    if (!editingText) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const cleanedText = cleanImportedText(formData.get("text").toString());
    if (!cleanedText) {
      return;
    }

    const wordCount = (cleanedText.match(/[^\s]+/g) || []).length;
    const selectedDifficulty = formData.get("difficulty").toString().trim();
    const nextEntry = hydrateLibraryText({
      ...editingText,
      title: formData.get("title").toString().trim() || editingText.title,
      tags: parseTags(formData.get("tags").toString()),
      text: cleanedText,
      detectedLanguage: detectLanguageFromText(cleanedText, state.targetLanguage),
      difficulty: selectedDifficulty || editingText.difficulty || estimateDifficulty(cleanedText),
      currentChunk: Math.min(editingText.currentChunk, Math.max(0, splitTextIntoReadingChunks(cleanedText).length - 1)),
      wordCount,
      characterCount: cleanedText.length,
    });

    state.libraryTexts = state.libraryTexts.map((entry) => (entry.id === editingText.id ? nextEntry : entry));
    state.activeLibraryTextId = nextEntry.id;
    state.libraryView = "reader";
    stopEditingLibraryText();
    persistLibraryTexts();
    render();
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!state.targetLanguage || !state.selectedSettingsDeck) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const editingCard = getEditingCard();
    const nextCard = hydrateCard({
      id: editingCard?.id || generateId(),
      language: state.targetLanguage,
      deck: editingCard?.deck || state.selectedSettingsDeck,
      prompt: formData.get("prompt").toString().trim(),
      hint: formData.get("hint").toString().trim(),
      answer: formData.get("answer").toString().trim(),
      notes: formData.get("notes").toString().trim(),
      audio: state.importedAudio,
      score: editingCard?.score ?? 0,
      stats: editingCard?.stats ?? createEmptyStats(),
    });

    if (!nextCard.deck || !nextCard.prompt || !nextCard.answer) {
      return;
    }

    ensureCustomDeck(state.targetLanguage, nextCard.deck);
    if (editingCard) {
      state.flashcards = state.flashcards.map((card) => (card.id === editingCard.id ? nextCard : card));
    } else {
      state.flashcards = [nextCard, ...state.flashcards];
    }
    persistFlashcards();
    persistSettings();
    stopEditingCard();
    render();
  });

  elements.grammarForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!state.targetLanguage) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const editingPoint = getEditingGrammarPoint();
    const nextPoint = hydrateGrammarPoint({
      id: editingPoint?.id || generateId(),
      referenceId: editingPoint?.referenceId || generateId(),
      language: state.targetLanguage,
      title: formData.get("title").toString().trim(),
      summary: formData.get("summary").toString().trim(),
      blocks: state.draftGrammarSections.map((section) => normalizeGrammarBlock(section)),
    });

    if (!nextPoint.title || !nextPoint.summary) {
      return;
    }

    if (editingPoint) {
      state.grammarPoints = state.grammarPoints.map((point) => (point.id === editingPoint.id ? nextPoint : point));
    } else {
      state.grammarPoints = [nextPoint, ...state.grammarPoints];
    }

    state.activeGrammarId = nextPoint.id;
    persistGrammarPoints();
    stopEditingGrammarPoint();
    state.grammarView = "page";
    render();
  });

  elements.card.addEventListener("click", (event) => {
    if (event.target.closest(".grammar-inline-link")) {
      return;
    }
    if (state.sessionComplete || state.isAdvancing || state.studyMode !== "flashcards") {
      return;
    }
    state.flipped = !state.flipped;
    renderFlashcard();
  });

  elements.flipCard.addEventListener("click", () => {
    if (state.sessionComplete || state.isAdvancing || state.studyMode !== "flashcards") {
      return;
    }
    state.flipped = !state.flipped;
    renderFlashcard();
  });

  elements.nextCard.addEventListener("click", advanceStudyCard);
  elements.playAudio.addEventListener("click", () => {
    const currentCard = getCurrentCard();
    const studyContent = currentCard ? getCardStudyContent(currentCard) : null;
    playAudioSource(currentCard?.audio, studyContent?.prompt || "", state.targetLanguage);
  });
  elements.markHard.addEventListener("click", () => updateFlashcardScore(-1, false));
  elements.markMedium.addEventListener("click", () => updateFlashcardScore(1, true));
  elements.markEasy.addEventListener("click", () => updateFlashcardScore(2, true));

  render();
}
