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
    kind: entry.kind === "folder" ? "folder" : "text",
    parentId: typeof entry.parentId === "string" ? entry.parentId : "",
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

function hydrateDeckRecord(entry) {
  return {
    id: typeof entry.id === "string" ? entry.id : generateId(),
    language: typeof entry.language === "string" ? entry.language : "",
    name: typeof entry.name === "string" ? entry.name : "",
    type: entry.type === "folder" ? "folder" : "deck",
    parentId: typeof entry.parentId === "string" ? entry.parentId : "",
  };
}

function buildExportBundle(state, options) {
  const includeFlashcards = Boolean(options?.includeFlashcards);
  const includeGrammar = Boolean(options?.includeGrammar);
  const includeLibrary = Boolean(options?.includeLibrary);
  const exportLanguage = options?.language?.trim() || "";
  const selectedDecks = Array.isArray(options?.selectedDecks) ? options.selectedDecks : [];
  const selectedGrammarIds = Array.isArray(options?.selectedGrammarIds) ? options.selectedGrammarIds : [];
  const selectedLibraryIds = Array.isArray(options?.selectedLibraryIds) ? options.selectedLibraryIds : [];
  const languageDeckEntries = state.settings.customDecks.filter((deck) => deck.language === exportLanguage);
  const selectedDeckFolders =
    selectedDecks.length === 0
      ? languageDeckEntries
      : (() => {
          const byId = new Map(languageDeckEntries.map((entry) => [entry.id, entry]));
          const includedIds = new Set();
          languageDeckEntries
            .filter((entry) => entry.type !== "folder" && selectedDecks.includes(entry.name))
            .forEach((entry) => {
              includedIds.add(entry.id);
              let parentId = entry.parentId || "";
              while (parentId) {
                includedIds.add(parentId);
                parentId = byId.get(parentId)?.parentId || "";
              }
            });
          return languageDeckEntries.filter((entry) => includedIds.has(entry.id));
        })();
  const flashcards = includeFlashcards
    ? state.flashcards.filter(
        (card) => card.language === exportLanguage && (selectedDecks.length === 0 || selectedDecks.includes(card.deck)),
      )
    : [];
  const grammarPoints = includeGrammar
    ? state.grammarPoints.filter(
        (point) => point.language === exportLanguage && (selectedGrammarIds.length === 0 || selectedGrammarIds.includes(point.id)),
      )
    : [];
  const libraryTexts = includeLibrary
    ? state.libraryTexts.filter(
        (entry) => entry.language === exportLanguage && (selectedLibraryIds.length === 0 || selectedLibraryIds.includes(entry.id)),
      )
    : [];

  return {
    app: "kapp",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: {
      targetLanguage: exportLanguage,
      customLanguages: exportLanguage ? [exportLanguage] : [],
      customDecks: includeFlashcards ? selectedDeckFolders : [],
    },
    flashcards: flashcards.map((card) => ({
          ...card,
          score: 0,
          stats: createEmptyStats(),
        })),
    grammarPoints,
    libraryTexts: libraryTexts.map((entry) => ({
          ...entry,
          status: "unread",
          progress: 0,
          currentChunk: 0,
        })),
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
            .map(hydrateDeckRecord)
        : [],
    },
    flashcards: Array.isArray(bundle.flashcards) ? bundle.flashcards.map(hydrateCard) : [],
    grammarPoints: Array.isArray(bundle.grammarPoints) ? bundle.grammarPoints.map(hydrateGrammarPoint) : [],
    libraryTexts: Array.isArray(bundle.libraryTexts) ? bundle.libraryTexts.map(hydrateLibraryText) : [],
  };
}

function getDeckConflictKey(entry) {
  return `${entry.language}::${entry.name}`;
}

function getTreeConflictKey(entry) {
  return `${entry.language}::${entry.parentId || ""}::${entry.title || entry.name}`;
}

function getGrammarConflictKey(point) {
  return `${point.language}::${point.title.trim().toLowerCase()}`;
}

function getLibraryConflictKey(entry) {
  return `${entry.language}::${entry.title.trim().toLowerCase()}`;
}

function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalizeText(value) {
  return stripAnnotationMarkup(value).trim().toLowerCase();
}

function normalizeSearchText(value) {
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

function getGrammarLinkMatches(value) {
  return [...value.toString().matchAll(/\{\{(.+?)::(.+?)\}\}/g)].map((match) => {
    const [raw, visibleText, referenceId] = match;
    const start = match.index ?? 0;
    return {
      raw,
      visibleText: visibleText.trim(),
      referenceId: referenceId.trim(),
      start,
      end: start + raw.length,
    };
  });
}

function getGrammarLinkMatchAtCursor(value, cursorIndex) {
  if (typeof cursorIndex !== "number") {
    return null;
  }

  return (
    getGrammarLinkMatches(value).find((match) => cursorIndex >= match.start && cursorIndex <= match.end) || null
  );
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
    consecutiveCorrect: 0,
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
    sourceTextId: typeof card.sourceTextId === "string" ? card.sourceTextId : "",
    sourceTextSnippet: typeof card.sourceTextSnippet === "string" ? card.sourceTextSnippet : "",
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
    kind: point.kind === "folder" ? "folder" : "point",
    parentId: typeof point.parentId === "string" ? point.parentId : "",
    referenceId:
      typeof point.referenceId === "string" && point.referenceId.trim()
        ? slugify(point.referenceId)
        : slugify(point.title || point.id || "grammar-point"),
    language: typeof point.language === "string" ? point.language : "",
    title: typeof point.title === "string" ? point.title : "",
    summary: typeof point.summary === "string" ? point.summary : "",
    blocks: Array.isArray(point.blocks)
      ? point.blocks.map(hydrateGrammarBlock).filter((block) => block.content || block.title || block.children.length)
      : point.kind === "folder"
        ? []
        : legacyBlocks,
  };
}

function flattenGrammarBlockText(block) {
  const childrenText = Array.isArray(block.children) ? block.children.map(flattenGrammarBlockText).join(" ") : "";
  return [block.title, block.content, childrenText].filter(Boolean).join(" ");
}

if (!isBrowserRuntime()) {
  console.error("app.js is a browser entrypoint. Start the local server with: node server.js");
} else {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      let refreshing = false;

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      try {
        const registration = await navigator.serviceWorker.register("./sw.js");
        await registration.update();

        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            registration.update().catch(() => {});
          }
        });
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    });
  }

  const initial_settings = loadSettings();

  const state = {
    activeTab: initial_settings.targetLanguage ? "flashcards" : "intro",
    settings: initial_settings,
    flashcards: loadFlashcards(),
    libraryTexts: loadLibraryTexts(),
    activeDeck: ALL_DECKS,
    sessionCardOrder: [],
    sessionCardDirections: {},
    selectedSettingsDeck: "",
    currentIndex: 0,
    flipped: false,
    cardSwipePointerId: null,
    cardSwipeStartX: 0,
    cardSwipeDeltaX: 0,
    cardSwipeActive: false,
    suppressCardClick: false,
    importedAudio: "",
    editingCardId: "",
    grammarPoints: loadGrammarPoints(),
    activeGrammarId: "",
    editingGrammarId: "",
    activeLibraryTextId: "",
    editingLibraryTextId: "",
    selectedLibrarySnippet: "",
    libraryCaptureCollapsed: true,
    libraryGrammarSelection: { start: 0, end: 0, text: "" },
    activeLibraryGrammarToken: null,
    activeLibraryStyleToken: null,
    draggingTreeItem: null,
    collapsedTreeFolders: {},
    grammarSearch: "",
    librarySearch: "",
    flashcardsView: "settings",
    deckView: "library",
    grammarView: "library",
    libraryView: "list",
    draftGrammarSections: [],
    studyMode: "flashcards",
    studyFeedback: "",
    studyAnsweredCardId: "",
    typingAnswerPendingCardId: "",
    pendingTypingReviewCardId: "",
    submittedTypingAnswers: [],
    submittedTypingCorrect: false,
    submittedMultipleChoiceAnswer: "",
    submittedMultipleChoiceCorrect: false,
    multipleChoiceOptionOrders: {},
    sessionGoal: 10,
    sessionReviewedIds: [],
    sessionReviewLog: [],
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
    addLanguageForm: document.querySelector("#add-language-form"),
    targetLanguageInput: document.querySelector("#target-language-input"),
    featureTabs: [...document.querySelectorAll(".feature-tab")],
    tabPanels: [...document.querySelectorAll(".tab-panel")],
    grammarPanelTitle: document.querySelector("#grammar-panel-title"),
    libraryPanelTitle: document.querySelector("#library-panel-title"),
    libraryBrowserView: document.querySelector("#library-browser-view"),
    libraryPageView: document.querySelector("#library-page-view"),
    libraryImportView: document.querySelector("#library-import-view"),
    libraryEditorView: document.querySelector("#library-editor-view"),
    grammarLibraryView: document.querySelector("#grammar-library-view"),
    grammarPageView: document.querySelector("#grammar-page-view"),
    grammarEditorView: document.querySelector("#grammar-editor-view"),
    grammarBackToLibrary: document.querySelector("#grammar-back-to-library"),
    grammarEditCurrent: document.querySelector("#grammar-edit-current"),
    grammarCreateNew: document.querySelector("#grammar-create-new"),
    grammarCreateFolder: document.querySelector("#grammar-create-folder"),
    grammarPage: document.querySelector("#grammar-page"),
    grammarList: document.querySelector("#grammar-list"),
    grammarCount: document.querySelector("#grammar-count"),
    grammarSearchInput: document.querySelector("#grammar-search-input"),
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
    librarySearchInput: document.querySelector("#library-search-input"),
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
    libraryCreateNew: document.querySelector("#library-create-new"),
    libraryCreateFolder: document.querySelector("#library-create-folder"),
    editLibraryText: document.querySelector("#edit-library-text"),
    editingLibraryNote: document.querySelector("#editing-library-note"),
    libraryEditForm: document.querySelector("#library-edit-form"),
    libraryEditTitleInput: document.querySelector("#library-edit-title-input"),
    libraryEditTagsInput: document.querySelector("#library-edit-tags-input"),
    libraryEditDifficultyInput: document.querySelector("#library-edit-difficulty-input"),
    libraryEditTextInput: document.querySelector("#library-edit-text-input"),
    libraryVisualEditor: document.querySelector("#library-visual-editor"),
    libraryLinkPopover: document.querySelector("#library-link-popover"),
    libraryStylePopover: document.querySelector("#library-style-popover"),
    libraryGrammarSelectionStatus: document.querySelector("#library-grammar-selection-status"),
    libraryGrammarLinkSelect: document.querySelector("#library-grammar-link-select"),
    applyLibraryGrammarLink: document.querySelector("#apply-library-grammar-link"),
    libraryActiveGrammarLinkSelect: document.querySelector("#library-active-grammar-link-select"),
    updateLibraryGrammarLink: document.querySelector("#update-library-grammar-link"),
    removeLibraryGrammarLink: document.querySelector("#remove-library-grammar-link"),
    libraryActiveStyleSelect: document.querySelector("#library-active-style-select"),
    updateLibraryTextStyle: document.querySelector("#update-library-text-style"),
    removeLibraryTextStyle: document.querySelector("#remove-library-text-style"),
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
    startReview: document.querySelector("#start-review"),
    studyProgress: document.querySelector("#study-progress"),
    flashcardsSettingsView: document.querySelector("#flashcards-settings-view"),
    flashcardsSessionView: document.querySelector("#flashcards-session-view"),
    studySessionContent: document.querySelector("#study-session-content"),
    studyProgressBarFill: document.querySelector("#study-progress-bar-fill"),
    studySessionTitle: document.querySelector("#study-session-title"),
    studyModeBadge: document.querySelector("#study-mode-badge"),
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
    typingInlineStatus: document.querySelector("#typing-inline-status"),
    acceptTypingAnswer: document.querySelector("#accept-typing-answer"),
    practiceFeedback: document.querySelector("#practice-feedback"),
    languageSummaryStats: document.querySelector("#language-summary-stats"),
    languageChart: document.querySelector("#language-chart"),
    deckSummaryStats: document.querySelector("#deck-summary-stats"),
    deckChart: document.querySelector("#deck-chart"),
    cardStatList: document.querySelector("#card-stat-list"),
    decksPanelTitle: document.querySelector("#decks-panel-title"),
    decksBackToLibrary: document.querySelector("#decks-back-to-library"),
    deckLibraryView: document.querySelector("#deck-library-view"),
    deckPageView: document.querySelector("#deck-page-view"),
    deckCreateView: document.querySelector("#deck-create-view"),
    deckEditorView: document.querySelector("#deck-editor-view"),
    deckSummary: document.querySelector("#deck-summary"),
    deckCount: document.querySelector("#deck-count"),
    decksBackToPage: document.querySelector("#decks-back-to-page"),
    decksCreateNew: document.querySelector("#decks-create-new"),
    createCardInDeck: document.querySelector("#create-card-in-deck"),
    deckCardEditorTitle: document.querySelector("#deck-card-editor-title"),
    deckCardEditorCopy: document.querySelector("#deck-card-editor-copy"),
    dataTransferStatus: document.querySelector("#data-transfer-status"),
    exportAppDataForm: document.querySelector("#export-app-data-form"),
    exportLanguageSelect: document.querySelector("#export-language-select"),
    exportFlashcards: document.querySelector("#export-flashcards"),
    exportGrammar: document.querySelector("#export-grammar"),
    exportLibrary: document.querySelector("#export-library"),
    exportFlashcardsPicker: document.querySelector("#export-flashcards-picker"),
    exportGrammarPicker: document.querySelector("#export-grammar-picker"),
    exportLibraryPicker: document.querySelector("#export-library-picker"),
    exportDeckOptions: document.querySelector("#export-deck-options"),
    exportGrammarOptions: document.querySelector("#export-grammar-options"),
    exportLibraryOptions: document.querySelector("#export-library-options"),
    exportAppData: document.querySelector("#export-app-data"),
    importAppDataForm: document.querySelector("#import-app-data-form"),
    importAppDataFile: document.querySelector("#import-app-data-file"),
    importAppDataButton: document.querySelector("#import-app-data-button"),
    themeSettingsForm: document.querySelector("#theme-settings-form"),
    themeSelect: document.querySelector("#theme-select"),
    clearLocalData: document.querySelector("#clear-local-data"),
    createDeckForm: document.querySelector("#create-deck-form"),
    createDeckFolder: document.querySelector("#create-deck-folder"),
    backToTabsButton: document.querySelector("#back-to-tabs-button"),
    settingsDeckTitle: document.querySelector("#settings-deck-title"),
    selectedDeckMeta: document.querySelector("#selected-deck-meta"),
    deleteSelectedDeck: document.querySelector("#delete-selected-deck"),
    cardFormDeckLabel: document.querySelector("#card-form-deck-label"),
  };

  reconcileDeckRecords();

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
      return { targetLanguage: "", customLanguages: [], customDecks: [], theme: "sand" };
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
              .map(hydrateDeckRecord)
          : [],
        theme: typeof parsed.theme === "string" ? parsed.theme : "sand",
      };
    } catch {
      return { targetLanguage: "", customLanguages: [], customDecks: [], theme: "sand" };
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
        theme: state.settings.theme,
      }),
    );
  }

  function applyTheme() {
    document.body.dataset.theme = state.settings.theme || "sand";
    if (elements.themeSelect) {
      elements.themeSelect.value = state.settings.theme || "sand";
    }
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

    return state.grammarPoints.filter((point) => point.language === language && point.kind !== "folder");
  }

  function getLibraryTextsForLanguage(language) {
    if (!language) {
      return [];
    }

    return state.libraryTexts.filter((entry) => entry.language === language && entry.kind !== "folder");
  }

  function getGrammarEntriesForLanguage(language) {
    if (!language) {
      return [];
    }

    return state.grammarPoints.filter((point) => point.language === language);
  }

  function getLibraryEntriesForLanguage(language) {
    if (!language) {
      return [];
    }

    return state.libraryTexts.filter((entry) => entry.language === language);
  }

  function sortTreeEntries(left, right) {
    if ((left.kind === "folder" || left.type === "folder") !== (right.kind === "folder" || right.type === "folder")) {
      return (left.kind === "folder" || left.type === "folder") ? -1 : 1;
    }

    return (left.title || left.name).localeCompare(right.title || right.name);
  }

  function getTreeChildren(entries, parentId = "") {
    return entries.filter((entry) => (entry.parentId || "") === parentId).sort(sortTreeEntries);
  }

  function getTreeDescendantIds(entries, rootId) {
    const descendants = [];
    const stack = [rootId];

    while (stack.length > 0) {
      const currentId = stack.pop();
      entries.forEach((entry) => {
        if ((entry.parentId || "") === currentId) {
          descendants.push(entry.id);
          if (entry.kind === "folder" || entry.type === "folder") {
            stack.push(entry.id);
          }
        }
      });
    }

    return descendants;
  }

  function getTreeItemCount(entries, parentId = "") {
    return entries.filter((entry) => (entry.parentId || "") === parentId).length;
  }

  function includeAncestorFolders(entries, filteredEntries) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const includedIds = new Set(filteredEntries.map((entry) => entry.id));

    filteredEntries.forEach((entry) => {
      let parentId = entry.parentId || "";
      while (parentId) {
        includedIds.add(parentId);
        parentId = byId.get(parentId)?.parentId || "";
      }
    });

    return entries.filter((entry) => includedIds.has(entry.id));
  }

  function getTreeFolderStateKey(module, folderId) {
    return `${module}::${folderId}`;
  }

  function isTreeFolderOpen(module, folderId) {
    return !Boolean(state.collapsedTreeFolders[getTreeFolderStateKey(module, folderId)]);
  }

  function toggleTreeFolder(module, folderId) {
    const key = getTreeFolderStateKey(module, folderId);
    state.collapsedTreeFolders = {
      ...state.collapsedTreeFolders,
      [key]: isTreeFolderOpen(module, folderId),
    };
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

  function getGrammarEntriesForTargetLanguage() {
    return getGrammarEntriesForLanguage(state.targetLanguage);
  }

  function getLibraryEntriesForTargetLanguage() {
    return getLibraryEntriesForLanguage(state.targetLanguage);
  }

  function getDecks(language = state.targetLanguage) {
    return getDeckEntriesForLanguage(language)
      .filter((deck) => deck.type === "deck")
      .map((deck) => deck.name)
      .sort((left, right) => left.localeCompare(right));
  }

  function getDeckEntriesForLanguage(language = state.targetLanguage) {
    if (!language) {
      return [];
    }

    const records = state.settings.customDecks.filter((deck) => deck.language === language).map(hydrateDeckRecord);
    const deckNames = new Set(records.filter((deck) => deck.type === "deck").map((deck) => deck.name));

    getCardsForLanguage(language).forEach((card) => {
      if (!deckNames.has(card.deck)) {
        records.push(
          hydrateDeckRecord({
            id: generateId(),
            language,
            name: card.deck,
            type: "deck",
            parentId: "",
          }),
        );
        deckNames.add(card.deck);
      }
    });

    return records.sort(sortTreeEntries);
  }

  function getDeckEntryByName(language, deckName) {
    return getDeckEntriesForLanguage(language).find((deck) => deck.type === "deck" && deck.name === deckName) || null;
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
    return (card.stats.consecutiveCorrect || 0) >= 5;
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

  function ensureCustomDeck(language, deckName, parentId = "") {
    if (!language || !deckName) {
      return;
    }

    const exists = state.settings.customDecks.some(
      (deck) => deck.language === language && deck.name === deckName && deck.type !== "folder",
    );
    if (!exists) {
      state.settings.customDecks = [
        ...state.settings.customDecks,
        hydrateDeckRecord({ id: generateId(), language, name: deckName, type: "deck", parentId }),
      ];
      return;
    }

    state.settings.customDecks = state.settings.customDecks.map((deck) =>
      deck.language === language && deck.name === deckName && deck.type !== "folder"
        ? { ...deck, parentId: deck.parentId || parentId }
        : deck,
    );
  }

  function createCustomDeckFolder(language, name, parentId = "") {
    if (!language || !name) {
      return;
    }

    state.settings.customDecks = [
      ...state.settings.customDecks,
      hydrateDeckRecord({ id: generateId(), language, name, type: "folder", parentId }),
    ];
  }

  function removeCustomDeck(language, deckName) {
    state.settings.customDecks = state.settings.customDecks.filter(
      (deck) => !(deck.language === language && deck.name === deckName && deck.type !== "folder"),
    );
  }

  function reconcileDeckRecords() {
    let changed = false;
    const nextRecords = [...state.settings.customDecks];

    state.flashcards.forEach((card) => {
      const exists = nextRecords.some(
        (deck) => deck.language === card.language && deck.name === card.deck && deck.type !== "folder",
      );
      if (!exists) {
        nextRecords.push(
          hydrateDeckRecord({
            id: generateId(),
            language: card.language,
            name: card.deck,
            type: "deck",
            parentId: "",
          }),
        );
        changed = true;
      }
    });

    if (changed) {
      state.settings.customDecks = nextRecords;
      persistSettings();
    }
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
    state.submittedTypingAnswers = [];
    state.submittedTypingCorrect = false;
    state.submittedMultipleChoiceAnswer = "";
    state.submittedMultipleChoiceCorrect = false;
    elements.typingForm?.reset();
  }

  function resetCardSwipeState() {
    state.cardSwipePointerId = null;
    state.cardSwipeStartX = 0;
    state.cardSwipeDeltaX = 0;
    state.cardSwipeActive = false;
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
    resetCardSwipeState();
    state.currentIndex = 0;
    state.flipped = false;
    randomizeSessionCardOrder();
    state.sessionCardDirections = {};
    state.multipleChoiceOptionOrders = {};
    clearStudyAnswerState();
    state.sessionReviewedIds = [];
    state.sessionReviewLog = [];
    state.sessionAttempts = 0;
    state.sessionCorrect = 0;
    state.sessionComplete = false;
    state.sessionCompletionReason = "";
    state.flashcardsView = "settings";
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
    state.sessionReviewLog = [...state.sessionReviewLog, { cardId, isCorrect }];
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
    state.libraryGrammarSelection = { start: 0, end: 0, text: "" };
    state.activeLibraryGrammarToken = null;
    state.activeLibraryStyleToken = null;
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
    state.libraryGrammarSelection = { start: 0, end: 0, text: "" };
    state.activeLibraryGrammarToken = null;
    state.activeLibraryStyleToken = null;
    renderLibraryGrammarLinkOptions();
    renderLibraryVisualEditor();
    renderLibraryGrammarSelectionState();
    hideLibraryLinkPopover();
    hideLibraryStylePopover();
  }

  function renderLibraryGrammarLinkOptions() {
    const grammarPoints = getGrammarForTargetLanguage();
    const optionsHtml = [
      `<option value="">Choose a grammar rule</option>`,
      ...grammarPoints.map(
        (point) => `<option value="${escapeHtml(point.referenceId)}">${escapeHtml(point.title)}</option>`,
      ),
    ].join("");
    elements.libraryGrammarLinkSelect.innerHTML = optionsHtml;
    elements.libraryActiveGrammarLinkSelect.innerHTML = optionsHtml;
    elements.applyLibraryGrammarLink.disabled = grammarPoints.length === 0;
  }

  function renderLibraryVisualEditorText(value) {
    const source = value.toString();
    const pattern = /\(\((.+?)::(.+?)\)\)|\{\{(.+?)::(.+?)\}\}|\[\[(.+?)\]\]|\*\*(.+?)\*\*|__(.+?)__/g;
    let lastIndex = 0;
    let html = "";
    const supportedColors = new Set(["red", "green", "blue", "gold", "orange", "mint", "rose"]);

    for (const match of source.matchAll(pattern)) {
      const [raw, colorName, colorText, grammarText, grammarId, highlighted, boldText, italicText] = match;
      const start = match.index ?? 0;
      html += escapeHtml(source.slice(lastIndex, start));
      if (colorName) {
        const normalizedColor = supportedColors.has(colorName.trim().toLowerCase())
          ? colorName.trim().toLowerCase()
          : "accent";
        html += `<span data-annotation="color" data-color="${escapeHtml(normalizedColor)}" class="inline-color inline-color-${escapeHtml(
          normalizedColor,
        )}">${escapeHtml(colorText.trim())}</span>`;
      } else if (boldText) {
        html += `<strong data-annotation="bold" class="library-editor-style-token">${escapeHtml(boldText.trim())}</strong>`;
      } else if (italicText) {
        html += `<em data-annotation="italic" class="library-editor-style-token">${escapeHtml(italicText.trim())}</em>`;
      } else if (highlighted) {
        html += `<span data-annotation="highlight" class="inline-highlight">${escapeHtml(highlighted)}</span>`;
      } else {
        html += `<span data-annotation="grammar-link" data-grammar-reference="${escapeHtml(
          grammarId.trim(),
        )}" class="grammar-inline-link library-editor-grammar-link" contenteditable="false">${escapeHtml(
          grammarText.trim(),
        )}</span>`;
      }
      lastIndex = start + raw.length;
    }

    html += escapeHtml(source.slice(lastIndex));
    return html.replaceAll("\n", "<br />");
  }

  function renderLibraryVisualEditor() {
    const editor = elements.libraryVisualEditor;
    if (!editor) {
      return;
    }

    editor.innerHTML = elements.libraryEditTextInput.value
      ? renderLibraryVisualEditorText(elements.libraryEditTextInput.value)
      : "";
  }

  function serializeLibraryEditorNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;
    if (element.tagName === "BR") {
      return "\n";
    }

    const textContent = [...element.childNodes].map(serializeLibraryEditorNode).join("");
    const annotation = element.dataset.annotation || "";
    if (annotation === "grammar-link") {
      return `{{${textContent}::${element.dataset.grammarReference || ""}}}`;
    }
    if (annotation === "highlight") {
      return `[[${textContent}]]`;
    }
    if (annotation === "color") {
      return `((${element.dataset.color || "green"}::${textContent}))`;
    }
    if (annotation === "bold" || element.tagName === "STRONG") {
      return `**${textContent}**`;
    }
    if (annotation === "italic" || element.tagName === "EM") {
      return `__${textContent}__`;
    }
    if (element.tagName === "DIV" || element.tagName === "P") {
      return `${textContent}\n`;
    }
    return textContent;
  }

  function syncLibraryEditTextFromVisualEditor() {
    const editor = elements.libraryVisualEditor;
    if (!editor) {
      return;
    }

    const serialized = [...editor.childNodes].map(serializeLibraryEditorNode).join("").replace(/\n{3,}/g, "\n\n");
    elements.libraryEditTextInput.value = serialized.replace(/\n$/, "");
  }

  function getLibraryEditorSelection() {
    const selection = window.getSelection();
    const editor = elements.libraryVisualEditor;
    if (!selection || selection.rangeCount === 0 || !editor) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !editor.contains(anchorNode) || !editor.contains(focusNode)) {
      return null;
    }

    return { selection, range, text: selection.toString() };
  }

  function updateLibraryGrammarSelectionState() {
    const editorSelection = getLibraryEditorSelection();
    const selectedText = editorSelection?.text?.trim() || "";
    state.libraryGrammarSelection = { start: 0, end: 0, text: selectedText };
    renderLibraryGrammarSelectionState();
  }

  function renderLibraryGrammarSelectionState() {
    const selectedText = state.libraryGrammarSelection.text.trim();
    elements.libraryGrammarSelectionStatus.textContent = selectedText
      ? `Selected text: "${selectedText}"`
      : "Select text in the editor to link it to a grammar point.";
    elements.applyLibraryGrammarLink.disabled = !selectedText || !elements.libraryGrammarLinkSelect.value;
  }

  function showLibraryLinkPopover(target) {
    const popover = elements.libraryLinkPopover;
    const wrap = popover.parentElement;
    const targetRect = target.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    popover.style.left = `${targetRect.left - wrapRect.left}px`;
    popover.style.top = `${targetRect.bottom - wrapRect.top + 8}px`;
    popover.classList.remove("hidden");
  }

  function hideLibraryLinkPopover() {
    elements.libraryLinkPopover.classList.add("hidden");
    elements.libraryLinkPopover.style.removeProperty("left");
    elements.libraryLinkPopover.style.removeProperty("top");
  }

  function showLibraryStylePopover(target) {
    const popover = elements.libraryStylePopover;
    const wrap = popover.parentElement;
    const targetRect = target.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    popover.style.left = `${targetRect.left - wrapRect.left}px`;
    popover.style.top = `${targetRect.bottom - wrapRect.top + 8}px`;
    popover.classList.remove("hidden");
  }

  function hideLibraryStylePopover() {
    elements.libraryStylePopover.classList.add("hidden");
    elements.libraryStylePopover.style.removeProperty("left");
    elements.libraryStylePopover.style.removeProperty("top");
  }

  function openLibraryGrammarPopover(target) {
    state.activeLibraryGrammarToken = { element: target };
    state.activeLibraryStyleToken = null;
    elements.libraryActiveGrammarLinkSelect.value = target.dataset.grammarReference || "";
    elements.updateLibraryGrammarLink.disabled = !elements.libraryActiveGrammarLinkSelect.value;
    elements.removeLibraryGrammarLink.disabled = false;
    hideLibraryStylePopover();
    showLibraryLinkPopover(target);
  }

  function openLibraryStylePopover(target) {
    state.activeLibraryStyleToken = { element: target };
    state.activeLibraryGrammarToken = null;
    elements.libraryActiveStyleSelect.value = target.dataset.annotation === "italic" ? "italic" : "bold";
    hideLibraryLinkPopover();
    showLibraryStylePopover(target);
  }

  function applyLibraryGrammarLinkFromSelection() {
    const editorSelection = getLibraryEditorSelection();
    const referenceId = elements.libraryGrammarLinkSelect.value;
    const selectedText = editorSelection?.text?.trim() || "";
    if (!editorSelection || !referenceId || !selectedText || editorSelection.range.collapsed) {
      return;
    }

    const link = document.createElement("span");
    link.dataset.annotation = "grammar-link";
    link.dataset.grammarReference = referenceId;
    link.className = "grammar-inline-link library-editor-grammar-link";
    link.contentEditable = "false";
    link.textContent = selectedText;

    editorSelection.range.deleteContents();
    editorSelection.range.insertNode(link);
    const selection = window.getSelection();
    const afterRange = document.createRange();
    afterRange.setStartAfter(link);
    afterRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(afterRange);

    syncLibraryEditTextFromVisualEditor();
    state.libraryGrammarSelection = { start: 0, end: 0, text: "" };
    renderLibraryGrammarSelectionState();
    openLibraryGrammarPopover(link);
  }

  function updateActiveLibraryGrammarLink() {
    const link = state.activeLibraryGrammarToken?.element;
    const nextReferenceId = elements.libraryActiveGrammarLinkSelect.value;
    if (!link || !nextReferenceId) {
      return;
    }

    link.dataset.grammarReference = nextReferenceId;
    syncLibraryEditTextFromVisualEditor();
    state.activeLibraryGrammarToken = null;
    hideLibraryLinkPopover();
  }

  function removeActiveLibraryGrammarLink() {
    const link = state.activeLibraryGrammarToken?.element;
    if (!link) {
      return;
    }

    link.replaceWith(document.createTextNode(link.textContent || ""));
    state.activeLibraryGrammarToken = null;
    syncLibraryEditTextFromVisualEditor();
    hideLibraryLinkPopover();
  }

  function updateActiveLibraryTextStyle() {
    const token = state.activeLibraryStyleToken?.element;
    const nextStyle = elements.libraryActiveStyleSelect.value;
    if (!token || !nextStyle) {
      return;
    }

    const replacement = document.createElement(nextStyle === "italic" ? "em" : "strong");
    replacement.dataset.annotation = nextStyle;
    replacement.className = "library-editor-style-token";
    replacement.textContent = token.textContent || "";
    token.replaceWith(replacement);
    state.activeLibraryStyleToken = null;
    syncLibraryEditTextFromVisualEditor();
    hideLibraryStylePopover();
  }

  function removeActiveLibraryTextStyle() {
    const token = state.activeLibraryStyleToken?.element;
    if (!token) {
      return;
    }

    token.replaceWith(document.createTextNode(token.textContent || ""));
    state.activeLibraryStyleToken = null;
    syncLibraryEditTextFromVisualEditor();
    hideLibraryStylePopover();
  }

  function handleLibraryVisualEditorInteraction(target) {
    const link = target.closest(".library-editor-grammar-link");
    if (link) {
      openLibraryGrammarPopover(link);
      return;
    }

    const styleToken = target.closest(".library-editor-style-token");
    if (styleToken) {
      openLibraryStylePopover(styleToken);
    } else {
      state.activeLibraryGrammarToken = null;
      hideLibraryLinkPopover();
      state.activeLibraryStyleToken = null;
      hideLibraryStylePopover();
    }
  }

  function renderCardFormState() {
    const isEditing = Boolean(getEditingCard());
    elements.saveCardButton.textContent = isEditing ? "Save changes" : "Save card";
    elements.cancelEditCard.classList.toggle("hidden", !isEditing);
    elements.editingCardNote.classList.toggle("hidden", !isEditing);
    if (elements.deckCardEditorTitle) {
      elements.deckCardEditorTitle.textContent = isEditing ? "Edit card" : "New card";
    }
    if (elements.deckCardEditorCopy) {
      elements.deckCardEditorCopy.textContent = isEditing
        ? "Update this card, then return to the deck list."
        : "Create a new card for this deck, then return to the deck list.";
    }
    elements.cardFormDeckLabel.textContent = state.selectedSettingsDeck
      ? "Add or edit cards in this deck."
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
    targetCard.stats.consecutiveCorrect = isCorrect ? (targetCard.stats.consecutiveCorrect || 0) + 1 : 0;
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
    state.deckView = "library";
    stopEditingCard();
    stopEditingGrammarPoint();
    resetSession();
    persistSettings();
  }

  function deleteLanguage(language) {
    const targetLanguage = language.toString().trim();
    if (!targetLanguage) {
      return;
    }

    state.flashcards = state.flashcards.filter((card) => card.language !== targetLanguage);
    state.grammarPoints = state.grammarPoints.filter((point) => point.language !== targetLanguage);
    state.libraryTexts = state.libraryTexts.filter((entry) => entry.language !== targetLanguage);
    state.settings.customDecks = state.settings.customDecks.filter((deck) => deck.language !== targetLanguage);
    state.settings.customLanguages = state.settings.customLanguages.filter((entry) => entry !== targetLanguage);

    const remainingLanguages = getLanguages().filter((entry) => entry !== targetLanguage);
    state.targetLanguage = remainingLanguages[0] || "";
    state.settings.targetLanguage = state.targetLanguage;
    state.activeDeck = ALL_DECKS;
    state.activeGrammarId = "";
    state.activeLibraryTextId = "";
    state.selectedSettingsDeck = "";
    state.deckView = "library";
    state.libraryView = "list";
    state.grammarView = "library";
    stopEditingCard();
    stopEditingGrammarPoint();
    stopEditingLibraryText();
    resetSession();
    persistFlashcards();
    persistGrammarPoints();
    persistLibraryTexts();
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

  function getLibraryLinkedCards(textId) {
    if (!textId) {
      return [];
    }

    return state.flashcards.filter(
      (card) => card.language === state.targetLanguage && card.sourceTextId === textId && card.sourceTextSnippet.trim(),
    );
  }

  function wrapSnippetMatches(container, snippet, cards) {
    if (!snippet || !container) {
      return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement?.closest(".grammar-inline-link, .library-card-link")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    for (const node of textNodes) {
      const value = node.nodeValue || "";
      const index = value.indexOf(snippet);
      if (index === -1) {
        continue;
      }

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + snippet.length);
      const wrapper = document.createElement("span");
      wrapper.className = "library-card-link";
      wrapper.tabIndex = 0;
      wrapper.dataset.translation = cards.map((card) => stripAnnotationMarkup(card.answer)).join(" · ");
      wrapper.dataset.deck = cards[0]?.deck || "";
      range.surroundContents(wrapper);
      break;
    }
  }

  function attachLibraryCardLinks(container, textId) {
    if (!container || !textId) {
      return;
    }

    const linkedCards = getLibraryLinkedCards(textId);
    const groupedCards = new Map();
    linkedCards.forEach((card) => {
      const key = stripAnnotationMarkup(card.sourceTextSnippet).trim();
      if (!key) {
        return;
      }
      if (!groupedCards.has(key)) {
        groupedCards.set(key, []);
      }
      groupedCards.get(key).push(card);
    });

    [...groupedCards.entries()]
      .sort((left, right) => right[0].length - left[0].length)
      .forEach(([snippet, cards]) => {
        wrapSnippetMatches(container, snippet, cards);
      });

    [...container.querySelectorAll(".library-card-link")].forEach((link) => {
      const showTooltip = () => {
        link.dataset.tooltipVisible = "true";
      };
      const hideTooltip = () => {
        link.dataset.tooltipVisible = "false";
      };
      link.addEventListener("mouseenter", showTooltip);
      link.addEventListener("focus", showTooltip);
      link.addEventListener("mouseleave", hideTooltip);
      link.addEventListener("blur", hideTooltip);
    });
  }

  function createExportSelectionMarkup(items, inputName, emptyText) {
    if (items.length === 0) {
      return `<p class="list-meta">${emptyText}</p>`;
    }

    return items
      .map(
        (item) => `
          <label class="export-choice-row">
            <input type="checkbox" name="${escapeHtml(inputName)}" value="${escapeHtml(item.value)}" checked />
            <span>${escapeHtml(item.label)}</span>
          </label>
        `,
      )
      .join("");
  }

  function renderExportPickers() {
    const exportLanguage = elements.exportLanguageSelect.value.trim();
    const decks = exportLanguage ? getDecks(exportLanguage) : [];
    const grammarPoints = exportLanguage ? getGrammarForLanguage(exportLanguage) : [];
    const libraryTexts = exportLanguage ? getLibraryTextsForLanguage(exportLanguage) : [];

    elements.exportDeckOptions.innerHTML = createExportSelectionMarkup(
      decks.map((deck) => ({ value: deck, label: deck })),
      "selectedDecks",
      "No decks available for this language.",
    );
    elements.exportGrammarOptions.innerHTML = createExportSelectionMarkup(
      grammarPoints.map((point) => ({ value: point.id, label: point.title })),
      "selectedGrammarIds",
      "No grammar points available for this language.",
    );
    elements.exportLibraryOptions.innerHTML = createExportSelectionMarkup(
      libraryTexts.map((entry) => ({ value: entry.id, label: entry.title })),
      "selectedLibraryIds",
      "No texts available for this language.",
    );

    elements.exportFlashcardsPicker.classList.toggle("hidden", !elements.exportFlashcards.checked);
    elements.exportGrammarPicker.classList.toggle("hidden", !elements.exportGrammar.checked);
    elements.exportLibraryPicker.classList.toggle("hidden", !elements.exportLibrary.checked);
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
      elements.languageTabs.innerHTML = `<p class="list-meta">No languages yet.</p>`;
    }

    languages.forEach((language) => {
      const item = document.createElement("div");
      item.className = `language-tab${language === state.targetLanguage ? " is-active" : ""}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "language-tab-label";
      button.textContent = language;
      button.addEventListener("click", () => {
        setTargetLanguage(language);
        render();
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "language-tab-delete";
      deleteButton.setAttribute("aria-label", `Delete ${language}`);
      deleteButton.textContent = "x";
      deleteButton.addEventListener("click", () => {
        const cardsCount = getCardsForLanguage(language).length;
        const grammarCount = getGrammarForLanguage(language).length;
        const textsCount = getLibraryTextsForLanguage(language).length;
        const shouldDelete = window.confirm(
          `Delete ${language} and all its data?\n\nThis will remove ${cardsCount} cards, ${grammarCount} grammar points, ${textsCount} texts, and its decks on this device.`,
        );
        if (!shouldDelete) {
          return;
        }

        deleteLanguage(language);
        render();
      });

      item.append(button, deleteButton);
      elements.languageTabs.append(item);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "language-tab language-tab-add";
    addButton.textContent = "+";
    addButton.setAttribute("aria-label", "Add language");
    addButton.addEventListener("click", () => {
      elements.addLanguageForm.classList.toggle("is-open");
      if (elements.addLanguageForm.classList.contains("is-open")) {
        elements.targetLanguageInput.focus();
      }
    });
    elements.languageTabs.append(addButton);
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
      state.selectedSettingsDeck = "";
      state.deckView = "library";
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
    if ((!state.targetLanguage || visibleCards.length === 0) && state.flashcardsView === "session") {
      state.flashcardsView = "settings";
    }

    const reviewed = state.sessionReviewedIds.length;
    const target = getSessionTargetCount();
    const accuracy = Math.round((state.sessionCorrect / Math.max(1, state.sessionAttempts)) * 100);
    const progressPercent = Math.round((reviewed / Math.max(1, target)) * 100);

    elements.flashcardsSettingsView.classList.toggle("hidden", state.flashcardsView !== "settings");
    elements.flashcardsSessionView.classList.toggle("hidden", state.flashcardsView === "settings");
    elements.studyProgressBarFill.style.width = `${Math.max(0, Math.min(100, progressPercent))}%`;
    elements.studySessionTitle.textContent = state.sessionComplete ? "Review complete" : "Focused Study Session";
    elements.studyModeBadge.textContent = {
      flashcards: "Mode: Flashcards",
      "multiple-choice": "Mode: Multiple choice",
      typing: "Mode: Typing",
    }[state.studyMode];

    elements.studyProgress.innerHTML = [
      createMetricCard(`${visibleCards.length}`, "Cards in current deck scope"),
      createMetricCard(`${Math.min(state.sessionGoal, Math.max(1, visibleCards.length || state.sessionGoal))}`, "Goal this session"),
    ].join("");
    elements.startReview.disabled = !state.targetLanguage || visibleCards.length === 0;
  }

  function renderFlashcard() {
    const currentCard = getCurrentCard();
    const swipeRotation = Math.max(-12, Math.min(12, state.cardSwipeDeltaX / 18));
    const swipeStrength = Math.min(Math.abs(state.cardSwipeDeltaX) / 140, 1);
    const swipeDirection =
      state.cardSwipeDeltaX >= 24 ? "right" : state.cardSwipeDeltaX <= -24 ? "left" : "";

    if (!state.targetLanguage) {
      resetCardSwipeState();
      elements.cardFrontText.textContent = "Set a target language.";
      elements.cardFrontMeta.textContent = "This applies to the whole app, not just flashcards.";
      elements.cardBackText.textContent = "Once a language is set, you can study, practice, and track progress.";
      elements.cardBackMeta.textContent = "";
      elements.playAudio.disabled = true;
      elements.card.classList.remove("is-flipped");
      elements.card.classList.remove("is-dragging");
      elements.card.classList.remove("is-swipe-right", "is-swipe-left");
      elements.card.style.removeProperty("--swipe-x");
      elements.card.style.removeProperty("--swipe-tilt");
      elements.card.style.removeProperty("--swipe-feedback-opacity");
      elements.card.disabled = true;
      return;
    }

    if (!currentCard) {
      resetCardSwipeState();
      elements.cardFrontText.textContent = `No flashcards for ${state.targetLanguage} yet.`;
      elements.cardFrontMeta.textContent = "Add cards in Settings and come back to start an immersive session.";
      elements.cardBackText.textContent = "Statistics will appear after you start practicing.";
      elements.cardBackMeta.textContent = "";
      elements.playAudio.disabled = true;
      elements.card.classList.remove("is-flipped");
      elements.card.classList.remove("is-dragging");
      elements.card.classList.remove("is-swipe-right", "is-swipe-left");
      elements.card.style.removeProperty("--swipe-x");
      elements.card.style.removeProperty("--swipe-tilt");
      elements.card.style.removeProperty("--swipe-feedback-opacity");
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
    elements.card.classList.toggle("is-dragging", state.cardSwipeActive);
    elements.card.classList.toggle("is-swipe-right", swipeDirection === "right");
    elements.card.classList.toggle("is-swipe-left", swipeDirection === "left");
    elements.card.style.setProperty("--swipe-x", `${state.cardSwipeDeltaX}px`);
    elements.card.style.setProperty("--swipe-tilt", `${swipeRotation}deg`);
    elements.card.style.setProperty("--swipe-feedback-opacity", `${swipeStrength}`);
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
    const reviewEntries = state.sessionReviewLog
      .map((entry) => ({
        ...entry,
        card: state.flashcards.find((card) => card.id === entry.cardId),
      }))
      .filter((entry) => entry.card);

    elements.sessionEndTitle.textContent =
      state.sessionCompletionReason === "deck"
        ? "You reached the end of this deck."
        : "You reached your session goal.";
    elements.sessionEndStats.innerHTML = [
      createMetricCard(state.sessionReviewedIds.length, "Cards reviewed"),
      createMetricCard(`${accuracy}%`, "Session accuracy"),
      createMetricCard(knownCards, "Known cards in this run"),
    ].join("");
    elements.sessionEndSummary.innerHTML = reviewEntries.length
      ? reviewEntries
          .map(
            ({ card, isCorrect }) => `
              <div class="mini-row ${isCorrect ? "is-correct" : "is-incorrect"}">
                <strong>${renderHighlightedText(card.prompt)}</strong>
                <span>${isCorrect ? "Correct" : "Incorrect"} · ${card.deck} · ${getAccuracy(card)}% correct overall · ${card.stats.attempts} total practices</span>
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
          state.deckView = "editor";
          startEditingCard(card.id);
          render();
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
    const cacheKey = `${card.id}::${studyContent.direction}`;
    if (Array.isArray(state.multipleChoiceOptionOrders[cacheKey]) && state.multipleChoiceOptionOrders[cacheKey].length > 0) {
      return state.multipleChoiceOptionOrders[cacheKey];
    }

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
    const options = [getMultipleChoiceAnswerText(studyContent.answer), ...distractors]
      .slice(0, 4)
      .sort(() => Math.random() - 0.5);
    state.multipleChoiceOptionOrders[cacheKey] = options;
    return options;
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
    const isSubmitted = Boolean(state.studyAnsweredCardId);

    if (blankParts.length === 0) {
      elements.typingCloze.innerHTML = "";
      elements.typingCloze.classList.add("hidden");
      elements.typingAnswerLabel.classList.remove("hidden");
      return;
    }

    elements.typingCloze.innerHTML = parts
      .map((part, index) => {
        if (part.type === "blank") {
          const blankIndex = parts.slice(0, index + 1).filter((entry) => entry.type === "blank").length - 1;
          const blankLength = Math.max(4, Math.min(24, stripAnnotationMarkup(part.value || "").trim().length || 6));
          if (isSubmitted) {
            const submittedValue = state.submittedTypingAnswers[blankIndex] || "";
            const marker = state.submittedTypingCorrect ? "v" : "x";
            const answerLength = Math.max(4, Math.min(24, submittedValue.trim().length || blankLength));
            return `<span class="typing-answer-chip ${state.submittedTypingCorrect ? "is-correct" : "is-incorrect"}" style="--typing-box-ch: ${answerLength};">${escapeHtml(
              submittedValue || " ",
            )}<span class="typing-answer-mark">${marker}</span></span>`;
          }

          return `<input class="typing-blank-input" type="text" data-blank-index="${blankIndex}" style="--typing-box-ch: ${blankLength};" placeholder="" aria-label="Missing word" />`;
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

  function updateTypingInputWidth(value = "") {
    const basis = (value || elements.typingAnswerInput.placeholder || "").trim();
    const widthCh = Math.max(6, Math.min(28, basis.length || 12));
    elements.typingAnswerInput.style.setProperty("--typing-input-ch", String(widthCh));
  }

  function renderStudyMode() {
    const currentCard = getCurrentCard();
    const isFlashcards = state.studyMode === "flashcards";
    const isMultipleChoice = state.studyMode === "multiple-choice";
    const isTyping = state.studyMode === "typing";
    const showNextAfterWrong =
      !isFlashcards &&
      state.studyAnsweredCardId === currentCard?.id &&
      ((isMultipleChoice && !state.submittedMultipleChoiceCorrect) ||
        (isTyping && !state.submittedTypingCorrect));

    renderStudyModeTabs();
    elements.card.classList.toggle("hidden", !isFlashcards);
    elements.studyPractice.classList.toggle("hidden", isFlashcards);
    elements.studyPractice.classList.toggle("is-typing-mode", isTyping);
    elements.studyPractice.classList.toggle("is-multiple-choice-mode", isMultipleChoice);
    elements.multipleChoicePanel.classList.toggle("is-active", isMultipleChoice);
    elements.typingForm.classList.toggle("is-active", isTyping);
    elements.flipCard.classList.toggle("hidden", !isFlashcards);
    elements.nextCard.classList.toggle("hidden", !isFlashcards && !showNextAfterWrong);
    elements.playAudio.classList.toggle("hidden", !isFlashcards);
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
        .map((option) => {
          const isSubmittedChoice = answered && option === state.submittedMultipleChoiceAnswer;
          const optionClass = isSubmittedChoice
            ? state.submittedMultipleChoiceCorrect
              ? "option-button is-correct"
              : "option-button is-incorrect"
            : "option-button";
          const optionMarker = isSubmittedChoice
            ? `<span class="option-status">${state.submittedMultipleChoiceCorrect ? "v" : "x"}</span>`
            : "";
          return `<button class="${optionClass}" type="button" data-answer="${option}" ${answered || state.isAdvancing || state.sessionComplete ? "disabled" : ""}>${escapeHtml(
            option,
          )}${optionMarker}</button>`;
        })
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
          state.submittedMultipleChoiceAnswer = button.dataset.answer || "";
          state.submittedMultipleChoiceCorrect = isCorrect;
          state.studyFeedback = isCorrect
            ? "Correct."
            : `Incorrect. Correct answer: ${stripAnnotationMarkup(studyContent.answer)}`;
          render();
          if (isCorrect && !state.sessionComplete) {
            schedulePracticeAutoAdvance();
          }
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
      if (!hasHighlightedAnswer) {
        elements.typingAnswerLabel.classList.remove("hidden");
        if (answered) {
          elements.typingAnswerInput.value = state.submittedTypingAnswers[0] || "";
          elements.typingAnswerInput.classList.toggle("typing-input-correct", state.submittedTypingCorrect);
          elements.typingAnswerInput.classList.toggle("typing-input-incorrect", !state.submittedTypingCorrect);
          elements.typingInlineStatus.textContent = state.submittedTypingCorrect ? "v" : "x";
          elements.typingInlineStatus.className = `typing-inline-status ${state.submittedTypingCorrect ? "is-correct" : "is-incorrect"}`;
        } else {
          elements.typingAnswerInput.classList.remove("typing-input-correct", "typing-input-incorrect");
          elements.typingInlineStatus.textContent = "";
          elements.typingInlineStatus.className = "typing-inline-status hidden";
        }
        updateTypingInputWidth(elements.typingAnswerInput.value);
      }
      elements.typingAnswerInput.disabled = answered || state.isAdvancing || state.sessionComplete;
      [...elements.typingCloze.querySelectorAll(".typing-blank-input")].forEach((input) => {
        input.disabled = answered || state.isAdvancing || state.sessionComplete;
      });
      submitButton.disabled = answered || state.isAdvancing || state.sessionComplete;
      submitButton.classList.toggle("hidden", answered);
      elements.acceptTypingAnswer.disabled = !canOverride || state.isAdvancing;
      elements.acceptTypingAnswer.classList.toggle("hidden", !answered);
    } else {
      elements.typingCloze.innerHTML = "";
      elements.typingCloze.classList.add("hidden");
      elements.typingAnswerLabel.classList.remove("hidden");
      elements.typingAnswerInput.classList.remove("typing-input-correct", "typing-input-incorrect");
      elements.typingInlineStatus.textContent = "";
      elements.typingInlineStatus.className = "typing-inline-status hidden";
      elements.typingAnswerInput.disabled = false;
      updateTypingInputWidth("");
      elements.typingForm.querySelector('button[type="submit"]').disabled = false;
      elements.typingForm.querySelector('button[type="submit"]').classList.remove("hidden");
      elements.acceptTypingAnswer.disabled = true;
      elements.acceptTypingAnswer.classList.add("hidden");
    }
  }

  function renderStatistics() {
    const currentLanguageCards = getCardsForTargetLanguage();
    const exportLanguages = getLanguages();
    const selectedExportLanguage =
      exportLanguages.includes(elements.exportLanguageSelect.value) ? elements.exportLanguageSelect.value : state.targetLanguage;
    elements.exportLanguageSelect.innerHTML = exportLanguages.length
      ? exportLanguages
          .map(
            (language) =>
              `<option value="${escapeHtml(language)}" ${language === selectedExportLanguage ? "selected" : ""}>${escapeHtml(language)}</option>`,
          )
          .join("")
      : `<option value="">No languages available</option>`;
    elements.exportLanguageSelect.disabled = exportLanguages.length === 0;
    renderExportPickers();
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
    elements.languageChart.innerHTML = createBarChartRows(languageRows, "No language statistics yet.");

    const deckRows = getDecks().map((deck) => {
      const cards = currentLanguageCards.filter((card) => card.deck === deck);
      const knownCards = cards.filter(isKnownCard).length;
      const percent = Math.round((knownCards / Math.max(1, cards.length)) * 100);
      return {
        label: deck,
        valueLabel: `${knownCards}/${cards.length} known`,
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
    elements.deckChart.innerHTML = createBarChartRows(deckRows, "No deck statistics yet.");

    const cardRows = currentLanguageCards
      .slice()
      .sort((left, right) => {
        if (left.stats.attempts === 0 && right.stats.attempts === 0) {
          return left.prompt.localeCompare(right.prompt);
        }
        return getAccuracy(right) - getAccuracy(left) || right.stats.attempts - left.stats.attempts;
      });

    elements.cardStatList.innerHTML = cardRows.length
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
      : `<p class="list-meta">No card statistics yet.</p>`;
  }

  function canMoveTreeEntry(entries, entryId, nextParentId) {
    if (entryId === nextParentId) {
      return false;
    }

    const entry = entries.find((item) => item.id === entryId);
    if (!entry) {
      return false;
    }

    if ((entry.kind === "folder" || entry.type === "folder") && nextParentId) {
      return !getTreeDescendantIds(entries, entryId).includes(nextParentId);
    }

    return true;
  }

  function attachTreeDragAndDrop(container, module) {
    if (!container) {
      return;
    }

    [...container.querySelectorAll("[data-tree-module]")].forEach((item) => {
      item.addEventListener("dragstart", (event) => {
        state.draggingTreeItem = {
          module,
          id: item.dataset.treeId,
          type: item.dataset.treeType,
        };
        event.dataTransfer.effectAllowed = "move";
        item.classList.add("is-dragging");
      });

      item.addEventListener("dragend", () => {
        state.draggingTreeItem = null;
        container.querySelectorAll(".is-drop-target").forEach((target) => target.classList.remove("is-drop-target"));
        item.classList.remove("is-dragging");
      });
    });

    [...container.querySelectorAll("[data-drop-parent]")].forEach((zone) => {
      zone.addEventListener("dragover", (event) => {
        if (!state.draggingTreeItem || state.draggingTreeItem.module !== module) {
          return;
        }

        event.preventDefault();
        zone.classList.add("is-drop-target");
      });

      zone.addEventListener("dragleave", () => {
        zone.classList.remove("is-drop-target");
      });

      zone.addEventListener("drop", (event) => {
        if (!state.draggingTreeItem || state.draggingTreeItem.module !== module) {
          return;
        }

        event.preventDefault();
        zone.classList.remove("is-drop-target");
        const nextParentId = zone.dataset.dropParent || "";

        if (module === "grammar") {
          moveGrammarEntry(state.draggingTreeItem.id, nextParentId);
        } else if (module === "library") {
          moveLibraryEntry(state.draggingTreeItem.id, nextParentId);
        } else if (module === "deck") {
          moveDeckEntry(state.draggingTreeItem.id, nextParentId);
        }
      });
    });
  }

  function moveGrammarEntry(entryId, nextParentId) {
    if (!canMoveTreeEntry(state.grammarPoints, entryId, nextParentId)) {
      return;
    }

    state.grammarPoints = state.grammarPoints.map((entry) =>
      entry.id === entryId ? { ...entry, parentId: nextParentId } : entry,
    );
    persistGrammarPoints();
    renderGrammar();
  }

  function moveLibraryEntry(entryId, nextParentId) {
    if (!canMoveTreeEntry(state.libraryTexts, entryId, nextParentId)) {
      return;
    }

    state.libraryTexts = state.libraryTexts.map((entry) =>
      entry.id === entryId ? { ...entry, parentId: nextParentId } : entry,
    );
    persistLibraryTexts();
    renderLibrary();
  }

  function moveDeckEntry(entryId, nextParentId) {
    if (!canMoveTreeEntry(state.settings.customDecks, entryId, nextParentId)) {
      return;
    }

    state.settings.customDecks = state.settings.customDecks.map((entry) =>
      entry.id === entryId ? { ...entry, parentId: nextParentId } : entry,
    );
    persistSettings();
    renderDeckSummary();
  }

  function deleteGrammarFolder(folderId) {
    const folder = state.grammarPoints.find((entry) => entry.id === folderId && entry.kind === "folder");
    if (!folder) {
      return;
    }

    if (getTreeItemCount(state.grammarPoints, folder.id) > 0) {
      window.alert("Move or remove the items inside this folder before deleting it.");
      return;
    }

    if (!window.confirm(`Delete folder ${folder.title}?`)) {
      return;
    }

    state.grammarPoints = state.grammarPoints.filter((entry) => entry.id !== folderId);
    persistGrammarPoints();
    renderGrammar();
  }

  function deleteLibraryFolder(folderId) {
    const folder = state.libraryTexts.find((entry) => entry.id === folderId && entry.kind === "folder");
    if (!folder) {
      return;
    }

    if (getTreeItemCount(state.libraryTexts, folder.id) > 0) {
      window.alert("Move or remove the items inside this folder before deleting it.");
      return;
    }

    if (!window.confirm(`Delete folder ${folder.title}?`)) {
      return;
    }

    state.libraryTexts = state.libraryTexts.filter((entry) => entry.id !== folderId);
    persistLibraryTexts();
    renderLibrary();
  }

  function deleteDeckFolder(folderId) {
    const folder = state.settings.customDecks.find((entry) => entry.id === folderId && entry.type === "folder");
    if (!folder) {
      return;
    }

    if (getTreeItemCount(state.settings.customDecks, folder.id) > 0) {
      window.alert("Move or remove the items inside this folder before deleting it.");
      return;
    }

    if (!window.confirm(`Delete folder ${folder.name}?`)) {
      return;
    }

    state.settings.customDecks = state.settings.customDecks.filter((entry) => entry.id !== folderId);
    persistSettings();
    renderDeckSummary();
  }

  function promptForFolderName(moduleLabel) {
    return window.prompt(`New ${moduleLabel} folder name:`)?.trim() || "";
  }

  function renderLibrary() {
    const entries = getLibraryEntriesForTargetLanguage();
    const texts = entries.filter((entry) => entry.kind !== "folder");
    const libraryQuery = normalizeSearchText(state.librarySearch);
    const filteredEntries = libraryQuery
      ? includeAncestorFolders(
          entries,
          entries.filter((entry) =>
            normalizeSearchText(
              [
                entry.title,
                Array.isArray(entry.tags) ? entry.tags.join(" ") : "",
                entry.kind === "folder" ? "" : entry.text,
              ]
                .filter(Boolean)
                .join(" "),
            ).includes(libraryQuery),
          ),
        )
      : entries;
    const activeText = getActiveLibraryText();
    const editingText = getEditingLibraryText();
    const unreadCount = texts.filter((entry) => entry.status === "unread").length;
    const readingCount = texts.filter((entry) => entry.status === "reading").length;
    const finishedCount = texts.filter((entry) => entry.status === "finished").length;
    const folderCount = entries.filter((entry) => entry.kind === "folder").length;

    elements.libraryCount.textContent = state.targetLanguage
      ? `${texts.length} texts${folderCount ? ` · ${folderCount} folders` : ""}`
      : "0 texts";
    elements.librarySearchInput.value = state.librarySearch;
    elements.libraryCaptureBody.classList.toggle("hidden", state.libraryCaptureCollapsed);
    elements.toggleLibraryCapture.textContent = state.libraryCaptureCollapsed ? "Show" : "Hide";
    elements.libraryBrowserView.classList.toggle("hidden", state.libraryView !== "list");
    elements.libraryPageView.classList.toggle("hidden", state.libraryView !== "reader");
    elements.libraryImportView.classList.toggle("hidden", state.libraryView !== "import");
    elements.libraryEditorView.classList.toggle("hidden", state.libraryView !== "editor");
    elements.libraryBackToList.classList.toggle("hidden", state.libraryView === "list");
    elements.editLibraryText.classList.toggle("hidden", state.libraryView !== "reader" || !activeText);
    elements.libraryCreateNew.classList.toggle("hidden", state.libraryView !== "list");
    elements.libraryCreateFolder.classList.toggle("hidden", state.libraryView !== "list");

    if (!state.targetLanguage) {
      elements.libraryPanelTitle.textContent = "Text library";
      elements.librarySummaryStats.innerHTML = "";
      elements.libraryGrammarLinkSelect.innerHTML = `<option value="">Choose a grammar rule</option>`;
      elements.libraryActiveGrammarLinkSelect.innerHTML = `<option value="">Choose a grammar rule</option>`;
      elements.applyLibraryGrammarLink.disabled = true;
      elements.updateLibraryGrammarLink.disabled = true;
      elements.removeLibraryGrammarLink.disabled = true;
      elements.librarySearchInput.value = "";
      elements.librarySearchInput.disabled = true;
      elements.libraryList.innerHTML = `<p class="list-meta">Select a target language to build a reading library.</p>`;
      elements.libraryReaderMeta.innerHTML = "";
      elements.libraryReaderContent.innerHTML = `<p class="list-meta">Import or select a text to start reading.</p>`;
      elements.libraryDeckSelect.innerHTML = `<option value="">No decks available</option>`;
      elements.libraryCardForm.reset();
      elements.librarySnippetInput.disabled = true;
      elements.libraryReadingProgress.classList.add("hidden");
      elements.libraryReaderActions.classList.add("hidden");
      elements.libraryImportView.classList.add("hidden");
      elements.libraryEditorView.classList.add("hidden");
      elements.editLibraryText.classList.add("hidden");
      elements.deleteLibraryText.classList.add("hidden");
      elements.libraryCreateNew.classList.remove("hidden");
      elements.libraryCreateFolder.classList.remove("hidden");
      return;
    }

    elements.librarySearchInput.disabled = false;

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
      createMetricCard(folderCount, "Folders"),
      createMetricCard(readingCount, "Currently reading"),
      createMetricCard(finishedCount, "Finished"),
    ].join("");

    const renderLibraryTree = (parentId = "", depth = 0) =>
      getTreeChildren(filteredEntries, parentId)
        .map((entry) => {
          if (entry.kind === "folder") {
            const isOpen = isTreeFolderOpen("library", entry.id);
            return `
              <section class="tree-node">
                <article class="tree-item folder-list-item${isOpen ? " is-open" : ""}" tabindex="0" draggable="true" data-tree-module="library" data-tree-id="${entry.id}" data-tree-type="folder" data-drop-parent="${entry.id}" style="--tree-depth:${depth}">
                  <div>
                    <strong>${isOpen ? "▾" : "▸"} ${escapeHtml(entry.title)}</strong>
                    <p>${getTreeItemCount(entries, entry.id)} items</p>
                  </div>
                  <div class="list-actions">
                    <button class="ghost delete-library-folder" type="button" data-library-folder-id="${entry.id}">Delete</button>
                  </div>
                </article>
                <div class="tree-children${isOpen ? "" : " hidden"}">${renderLibraryTree(entry.id, depth + 1)}</div>
              </section>
            `;
          }

          return `
            <article class="library-list-item tree-item${entry.id === state.activeLibraryTextId ? " is-active" : ""}" tabindex="0" draggable="true" data-tree-module="library" data-tree-id="${entry.id}" data-tree-type="text" style="--tree-depth:${depth}">
              <div>
                <strong>${escapeHtml(entry.title)}</strong>
                <p>${escapeHtml(entry.detectedLanguage || entry.language)} · ${escapeHtml(entry.difficulty)} · ${entry.progress}% read</p>
                ${renderTagChips(entry.tags)}
              </div>
              <span class="library-state state-${entry.status}">${escapeHtml(entry.status)}</span>
            </article>
          `;
        })
        .join("");

    elements.libraryList.innerHTML = filteredEntries.length
      ? `
          <div class="tree-drop-root" data-tree-module="library" data-drop-parent="">Drop here to move to root</div>
          ${renderLibraryTree()}
        `
      : `<p class="list-meta">${
          texts.length
            ? `No texts match "${escapeHtml(state.librarySearch)}".`
            : `No texts yet for ${state.targetLanguage}. Import one to start building the library.`
        }</p>`;

    [...elements.libraryList.querySelectorAll("[data-tree-type='text']")].forEach((item) => {
      const openEntry = () => {
        state.activeLibraryTextId = item.dataset.treeId;
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

    [...elements.libraryList.querySelectorAll(".delete-library-folder")].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteLibraryFolder(button.dataset.libraryFolderId);
      });
    });

    [...elements.libraryList.querySelectorAll(".folder-list-item[data-tree-module='library']")].forEach((item) => {
      const toggle = (event) => {
        if (event.target.closest(".delete-library-folder")) {
          return;
        }
        toggleTreeFolder("library", item.dataset.treeId);
        renderLibrary();
      };

      item.addEventListener("click", toggle);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle(event);
        }
      });
    });

    attachTreeDragAndDrop(elements.libraryList, "library");

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

    if (state.libraryView === "import") {
      elements.libraryPanelTitle.textContent = "Import text";
      elements.libraryReaderMeta.innerHTML = "";
      elements.libraryReadingProgress.classList.add("hidden");
      elements.libraryReaderActions.classList.add("hidden");
      elements.deleteLibraryText.classList.add("hidden");
      elements.editLibraryText.classList.add("hidden");
      return;
    }

    if (state.libraryView === "editor" && editingText) {
      elements.libraryPanelTitle.textContent = `Edit ${editingText.title}`;
      renderLibraryGrammarLinkOptions();
      renderLibraryGrammarSelectionState();
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
    attachLibraryCardLinks(elements.libraryReaderContent.querySelector(".library-text-body"), activeText.id);
    elements.libraryReaderActions.classList.remove("hidden");
    elements.libraryPreviousChunk.disabled = safeChunkIndex === 0;
    elements.libraryNextChunk.textContent = safeChunkIndex >= chunks.length - 1 ? "Finish" : "Next";
    elements.deleteLibraryText.classList.remove("hidden");
  }

  function renderGrammar() {
    const entries = getGrammarEntriesForTargetLanguage();
    const points = entries.filter((point) => point.kind !== "folder");
    const grammarQuery = normalizeSearchText(state.grammarSearch);
    const filteredPoints = grammarQuery
      ? includeAncestorFolders(
          entries,
          entries
          .map((point) => {
            const titleText = normalizeSearchText(point.title);
            const summaryText = normalizeSearchText(point.summary);
            const contentText =
              point.kind === "folder" ? "" : normalizeSearchText(point.blocks.map(flattenGrammarBlockText).join(" "));
            const titleIndex = titleText.indexOf(grammarQuery);
            const summaryIndex = summaryText.indexOf(grammarQuery);
            const contentIndex = contentText.indexOf(grammarQuery);

            let priority = 99;
            let position = Number.MAX_SAFE_INTEGER;
            if (titleIndex !== -1) {
              priority = 0;
              position = titleIndex;
            } else if (summaryIndex !== -1) {
              priority = 1;
              position = summaryIndex;
            } else if (contentIndex !== -1) {
              priority = 2;
              position = contentIndex;
            }

            return { point, priority, position };
          })
          .filter((entry) => entry.priority < 99)
          .sort(
            (left, right) =>
              left.priority - right.priority ||
              left.position - right.position ||
              left.point.title.localeCompare(right.point.title),
          )
          .map((entry) => entry.point)
        )
      : entries;
    const activePoint = getActiveGrammarPoint();
    const folderCount = entries.filter((entry) => entry.kind === "folder").length;

    elements.grammarCount.textContent = state.targetLanguage
      ? `${points.length} points${folderCount ? ` · ${folderCount} folders` : ""}`
      : "0 points";
    elements.grammarSearchInput.value = state.grammarSearch;
    elements.grammarLibraryView.classList.toggle("hidden", state.grammarView !== "library");
    elements.grammarPageView.classList.toggle("hidden", state.grammarView !== "page");
    elements.grammarEditorView.classList.toggle("hidden", state.grammarView !== "editor");
    elements.grammarBackToLibrary.classList.toggle("hidden", state.grammarView === "library");
    elements.grammarEditCurrent.classList.toggle(
      "hidden",
      state.grammarView !== "page" || !activePoint,
    );
    elements.grammarCreateFolder.classList.toggle("hidden", state.grammarView !== "library");

    if (!state.targetLanguage) {
      elements.grammarPanelTitle.textContent = "Grammar library";
      elements.grammarPage.innerHTML = `<p class="list-meta">Select a target language to start building grammar notes.</p>`;
      elements.grammarSearchInput.value = "";
      elements.grammarSearchInput.disabled = true;
      elements.grammarList.innerHTML = `<p class="list-meta">No language selected.</p>`;
      renderGrammarSectionsEditor();
      renderGrammarLinkSuggestions();
      return;
    }

    elements.grammarSearchInput.disabled = false;

    if (state.grammarView === "library") {
      elements.grammarPanelTitle.textContent = "Grammar library";
    } else if (state.grammarView === "editor") {
      elements.grammarPanelTitle.textContent = getEditingGrammarPoint() ? "Edit grammar point" : "New grammar point";
    } else {
      elements.grammarPanelTitle.textContent = activePoint?.title || "Grammar point";
    }

    const renderGrammarTree = (parentId = "", depth = 0) =>
      getTreeChildren(filteredPoints, parentId)
        .map((point) => {
          if (point.kind === "folder") {
            const isOpen = isTreeFolderOpen("grammar", point.id);
            return `
              <section class="tree-node">
                <article class="tree-item folder-list-item${isOpen ? " is-open" : ""}" tabindex="0" draggable="true" data-tree-module="grammar" data-tree-id="${point.id}" data-tree-type="folder" data-drop-parent="${point.id}" style="--tree-depth:${depth}">
                  <div>
                    <strong>${isOpen ? "▾" : "▸"} ${escapeHtml(point.title)}</strong>
                    <p>${getTreeItemCount(entries, point.id)} items</p>
                  </div>
                  <div class="list-actions">
                    <button class="ghost delete-grammar-folder" type="button" data-grammar-folder-id="${point.id}">Delete</button>
                  </div>
                </article>
                <div class="tree-children${isOpen ? "" : " hidden"}">${renderGrammarTree(point.id, depth + 1)}</div>
              </section>
            `;
          }

          return `
            <article class="grammar-list-item tree-item${point.id === state.activeGrammarId ? " is-active" : ""}" tabindex="0" draggable="true" data-tree-module="grammar" data-tree-id="${point.id}" data-tree-type="point" style="--tree-depth:${depth}">
              <div>
                <strong>${escapeHtml(point.title)}</strong>
                <p>${escapeHtml(point.summary)}</p>
              </div>
              <div class="list-actions">
                <button class="secondary edit-grammar" type="button" data-grammar-id="${point.id}">Edit</button>
                <button class="ghost delete-grammar" type="button" data-grammar-id="${point.id}">Delete</button>
              </div>
            </article>
          `;
        })
        .join("");

    elements.grammarList.innerHTML = filteredPoints.length
      ? `
          <div class="tree-drop-root" data-tree-module="grammar" data-drop-parent="">Drop here to move to root</div>
          ${renderGrammarTree()}
        `
      : `<p class="list-meta">${
          points.length
            ? `No grammar points match "${escapeHtml(state.grammarSearch)}".`
            : `No grammar points yet for ${state.targetLanguage}.`
        }</p>`;

    [...elements.grammarList.querySelectorAll(".grammar-list-item")].forEach((item) => {
      const openPoint = () => {
        state.activeGrammarId = item.dataset.treeId;
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

    [...elements.grammarList.querySelectorAll(".delete-grammar-folder")].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteGrammarFolder(button.dataset.grammarFolderId);
      });
    });

    [...elements.grammarList.querySelectorAll(".folder-list-item[data-tree-module='grammar']")].forEach((item) => {
      const toggle = (event) => {
        if (event.target.closest(".delete-grammar-folder")) {
          return;
        }
        toggleTreeFolder("grammar", item.dataset.treeId);
        renderGrammar();
      };

      item.addEventListener("click", toggle);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle(event);
        }
      });
    });

    attachTreeDragAndDrop(elements.grammarList, "grammar");

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
    const entries = getDeckEntriesForLanguage();
    const decks = entries.filter((deck) => deck.type === "deck");
    const folderCount = entries.filter((deck) => deck.type === "folder").length;
    elements.deckCount.textContent = state.targetLanguage
      ? `${decks.length} decks${folderCount ? ` · ${folderCount} folders` : ""}`
      : "0 decks";
    elements.deckLibraryView.classList.toggle("hidden", state.deckView !== "library");
    elements.deckCreateView.classList.toggle("hidden", state.deckView !== "create");
    elements.deckPageView.classList.toggle("hidden", state.deckView !== "page");
    elements.deckEditorView.classList.toggle("hidden", state.deckView !== "editor");
    elements.decksBackToLibrary.classList.toggle("hidden", !["create", "page"].includes(state.deckView));
    elements.decksBackToPage.classList.toggle("hidden", state.deckView !== "editor");
    elements.decksCreateNew.classList.toggle("hidden", state.deckView !== "library");

    if (!state.targetLanguage) {
      elements.decksPanelTitle.textContent = "";
      elements.deckSummary.innerHTML = `<p class="list-meta">Select a target language to manage its decks.</p>`;
      elements.settingsDeckTitle.textContent = "Deck workspace";
      elements.selectedDeckMeta.textContent = "Select a deck to manage its cards.";
      elements.deleteSelectedDeck.classList.add("hidden");
      elements.createCardInDeck.classList.add("hidden");
      elements.decksCreateNew.classList.remove("hidden");
      return;
    }

    if (entries.length === 0) {
      elements.decksPanelTitle.textContent = "";
      elements.deckSummary.innerHTML = `<p class="list-meta">No decks exist yet for ${state.targetLanguage}. Add cards below to create one.</p>`;
      elements.settingsDeckTitle.textContent = "Deck workspace";
      elements.selectedDeckMeta.textContent = "Create a deck to start adding cards.";
      elements.deleteSelectedDeck.classList.add("hidden");
      elements.createCardInDeck.classList.add("hidden");
      return;
    }

    elements.decksPanelTitle.textContent = "";

    const renderDeckTree = (parentId = "", depth = 0) =>
      getTreeChildren(entries, parentId)
        .map((entry) => {
          if (entry.type === "folder") {
            const isOpen = isTreeFolderOpen("deck", entry.id);
            return `
              <section class="tree-node">
                <article class="tree-item folder-list-item${isOpen ? " is-open" : ""}" tabindex="0" draggable="true" data-tree-module="deck" data-tree-id="${entry.id}" data-tree-type="folder" data-drop-parent="${entry.id}" style="--tree-depth:${depth}">
                  <div>
                    <strong>${isOpen ? "▾" : "▸"} ${escapeHtml(entry.name)}</strong>
                    <p>${getTreeItemCount(entries, entry.id)} items</p>
                  </div>
                  <div class="list-actions">
                    <button class="ghost delete-deck-folder" type="button" data-deck-folder-id="${entry.id}">Delete</button>
                  </div>
                </article>
                <div class="tree-children${isOpen ? "" : " hidden"}">${renderDeckTree(entry.id, depth + 1)}</div>
              </section>
            `;
          }

          const cards = getCardsForTargetLanguage().filter((card) => card.deck === entry.name);
          const studied = cards.filter((card) => card.stats.attempts > 0).length;
          const known = cards.filter(isKnownCard).length;
          return `
            <button class="deck-table-row settings-deck-row tree-item${entry.name === state.selectedSettingsDeck ? " is-active" : ""}" type="button" draggable="true" data-tree-module="deck" data-tree-id="${entry.id}" data-tree-type="deck" data-settings-deck="${escapeHtml(entry.name)}" style="--tree-depth:${depth}">
              <span>${escapeHtml(entry.name)}</span>
              <span>${cards.length} cards</span>
              <span>${studied} studied</span>
              <span>${known} known</span>
            </button>
          `;
        })
        .join("");

    elements.deckSummary.innerHTML = `
      <div class="deck-table settings-deck-list">
        <div class="tree-drop-root" data-tree-module="deck" data-drop-parent="">Drop here to move to root</div>
        ${renderDeckTree()}
      </div>
    `;

    [...elements.deckSummary.querySelectorAll("[data-settings-deck]")].forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedSettingsDeck = button.dataset.settingsDeck;
        state.deckView = "page";
        stopEditingCard();
        render();
      });
    });

    [...elements.deckSummary.querySelectorAll(".delete-deck-folder")].forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteDeckFolder(button.dataset.deckFolderId);
      });
    });

    [...elements.deckSummary.querySelectorAll(".folder-list-item[data-tree-module='deck']")].forEach((item) => {
      const toggle = (event) => {
        if (event.target.closest(".delete-deck-folder")) {
          return;
        }
        toggleTreeFolder("deck", item.dataset.treeId);
        renderDeckSummary();
      };

      item.addEventListener("click", toggle);
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle(event);
        }
      });
    });

    attachTreeDragAndDrop(elements.deckSummary, "deck");

    elements.settingsDeckTitle.textContent = state.selectedSettingsDeck || "Deck workspace";
    elements.selectedDeckMeta.textContent = state.selectedSettingsDeck
      ? `${getCardsForSettingsDeck().length} cards in this deck.`
      : "Select a deck to manage its cards.";
    elements.deleteSelectedDeck.classList.toggle("hidden", !state.selectedSettingsDeck);
    elements.createCardInDeck.classList.toggle("hidden", !state.selectedSettingsDeck);
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
    applyTheme();
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

    resetCardSwipeState();
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

  function schedulePracticeAutoAdvance() {
    cancelPendingAdvance();
    state.isAdvancing = true;
    renderStudyMode();
    state.advanceTimeoutId = window.setTimeout(() => {
      state.advanceTimeoutId = 0;
      state.isAdvancing = false;
      advanceStudyCard();
    }, 420);
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
    const existingEntry = getDeckEntryByName(state.targetLanguage, sourceDeck);
    ensureCustomDeck(state.targetLanguage, nextDeck, existingEntry?.parentId || "");
    state.settings.customDecks = state.settings.customDecks.map((deck) =>
      deck.language === state.targetLanguage && deck.name === sourceDeck && deck.type !== "folder"
        ? { ...deck, name: nextDeck }
        : deck,
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

    const nextSettings = {
      targetLanguage: state.settings.targetLanguage || bundle.settings.targetLanguage,
      customLanguages: [...new Set([...state.settings.customLanguages, ...bundle.settings.customLanguages])].sort((left, right) =>
        left.localeCompare(right),
      ),
      customDecks: [...state.settings.customDecks],
    };

    let nextFlashcards = [...state.flashcards];
    const currentDeckKeys = new Set(
      state.settings.customDecks.filter((deck) => deck.type !== "folder").map(getDeckConflictKey),
    );
    state.flashcards.forEach((card) => currentDeckKeys.add(getDeckConflictKey({ language: card.language, name: card.deck })));

    const importedDeckMap = new Map();
    bundle.flashcards.forEach((card) => {
      const key = getDeckConflictKey({ language: card.language, name: card.deck });
      if (!importedDeckMap.has(key)) {
        importedDeckMap.set(key, []);
      }
      importedDeckMap.get(key).push(card);
    });
    bundle.settings.customDecks.filter((deck) => deck.type !== "folder").forEach((deck) => {
      const key = getDeckConflictKey(deck);
      if (!importedDeckMap.has(key)) {
        importedDeckMap.set(key, []);
      }
    });

    importedDeckMap.forEach((cards, key) => {
      const [language, deckName] = key.split("::");
      const currentHasDeck = currentDeckKeys.has(key);
      const keepImported = !currentHasDeck
        ? true
        : window.confirm(`Deck "${deckName}" already exists in ${language}. Press OK to keep the imported deck and cards, or Cancel to keep your current deck.`);

      if (!keepImported) {
        return;
      }

      nextFlashcards = nextFlashcards.filter((card) => !(card.language === language && card.deck === deckName));
      nextFlashcards = [...cards, ...nextFlashcards];
      nextSettings.customDecks = [
        ...nextSettings.customDecks.filter(
          (deck) => !(deck.language === language && deck.name === deckName && deck.type !== "folder"),
        ),
        hydrateDeckRecord({ language, name: deckName, type: "deck" }),
      ];
    });

    bundle.settings.customDecks
      .filter((deck) => deck.type === "folder")
      .forEach((folder) => {
        const exists = nextSettings.customDecks.some(
          (entry) =>
            entry.type === "folder" &&
            entry.language === folder.language &&
            entry.name === folder.name &&
            (entry.parentId || "") === (folder.parentId || ""),
        );
        if (!exists) {
          nextSettings.customDecks = [...nextSettings.customDecks, hydrateDeckRecord(folder)];
        }
      });

    let nextGrammarPoints = [...state.grammarPoints];
    bundle.grammarPoints.forEach((point) => {
      const conflictKey = getGrammarConflictKey(point);
      const currentConflict = nextGrammarPoints.find((entry) => getGrammarConflictKey(entry) === conflictKey);
      if (!currentConflict) {
        nextGrammarPoints = [point, ...nextGrammarPoints];
        return;
      }

      const keepImported = window.confirm(
        `Grammar point "${point.title}" already exists in ${point.language}. Press OK to keep the imported version, or Cancel to keep your current one.`,
      );
      if (!keepImported) {
        return;
      }

      nextGrammarPoints = [point, ...nextGrammarPoints.filter((entry) => getGrammarConflictKey(entry) !== conflictKey)];
    });

    let nextLibraryTexts = [...state.libraryTexts];
    bundle.libraryTexts.forEach((entry) => {
      const conflictKey = getLibraryConflictKey(entry);
      const currentConflict = nextLibraryTexts.find((item) => getLibraryConflictKey(item) === conflictKey);
      if (!currentConflict) {
        nextLibraryTexts = [entry, ...nextLibraryTexts];
        return;
      }

      const keepImported = window.confirm(
        `Text "${entry.title}" already exists in ${entry.language}. Press OK to keep the imported version, or Cancel to keep your current one.`,
      );
      if (!keepImported) {
        return;
      }

      nextLibraryTexts = [entry, ...nextLibraryTexts.filter((item) => getLibraryConflictKey(item) !== conflictKey)];
    });

    state.settings = nextSettings;
    state.flashcards = nextFlashcards;
    state.grammarPoints = nextGrammarPoints;
    state.libraryTexts = nextLibraryTexts;
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

  elements.exportAppDataForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const exportLanguage = elements.exportLanguageSelect.value.trim();
    if (!exportLanguage) {
      elements.dataTransferStatus.textContent = "Choose one language to export.";
      return;
    }

    const formData = new FormData(event.currentTarget);

    const bundle = buildExportBundle(state, {
      language: exportLanguage,
      includeFlashcards: elements.exportFlashcards.checked,
      includeGrammar: elements.exportGrammar.checked,
      includeLibrary: elements.exportLibrary.checked,
      selectedDecks: formData.getAll("selectedDecks").map(String),
      selectedGrammarIds: formData.getAll("selectedGrammarIds").map(String),
      selectedLibraryIds: formData.getAll("selectedLibraryIds").map(String),
    });

    if (bundle.flashcards.length === 0 && bundle.grammarPoints.length === 0 && bundle.libraryTexts.length === 0) {
      elements.dataTransferStatus.textContent = "Choose at least one content type to export.";
      return;
    }

    const file = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const timestamp = new Date().toISOString().slice(0, 10);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kapp-data-${timestamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    elements.dataTransferStatus.textContent = "Selected data exported as a JSON bundle.";
  });
  elements.exportLanguageSelect.addEventListener("change", () => {
    renderExportPickers();
  });
  [elements.exportFlashcards, elements.exportGrammar, elements.exportLibrary].forEach((input) => {
    input.addEventListener("change", () => {
      renderExportPickers();
    });
  });

  elements.themeSettingsForm.addEventListener("change", (event) => {
    const nextTheme = new FormData(event.currentTarget).get("theme").toString();
    state.settings.theme = nextTheme || "sand";
    persistSettings();
    applyTheme();
  });

  elements.importAppDataForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = elements.importAppDataFile.files?.[0];
    if (!file) {
      return;
    }

    if (!window.confirm("Importing will merge this bundle into the local app data. Conflicts will ask which version to keep. Continue?")) {
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

  elements.clearLocalData.addEventListener("click", () => {
    if (!window.confirm("Clear all local Kapp data on this device? This cannot be undone.")) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(GRAMMAR_STORAGE_KEY);
    localStorage.removeItem(LIBRARY_STORAGE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    window.location.reload();
  });

  elements.featureTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      renderTabs();
    });
  });

  elements.backToTabsButton.addEventListener("click", () => {
    document.querySelector(".feature-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  elements.deckFilter.addEventListener("change", (event) => {
    state.activeDeck = event.target.value;
    resetSession();
    render();
  });

  elements.sessionGoal.addEventListener("change", (event) => {
    const nextGoal = Math.max(1, Number(event.target.value) || 1);
    state.sessionGoal = nextGoal;
    event.target.value = String(nextGoal);
    resetSession();
    render();
  });

  elements.startReview.addEventListener("click", () => {
    if (!state.targetLanguage || getVisibleFlashcards().length === 0) {
      return;
    }

    resetSession();
    state.flashcardsView = "session";
    render();
  });

  elements.restartSession.addEventListener("click", () => {
    resetSession();
    state.flashcardsView = "settings";
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
    state.submittedTypingAnswers =
      expectedHighlights.length > 0 ? typedBlankInputs.map((input) => input.value) : [typedAnswer];
    state.submittedTypingCorrect = isCorrect;
    state.studyFeedback = isCorrect ? "Correct." : `Incorrect. Correct answer: ${expectedAnswer}`;
    state.typingAnswerPendingCardId = isCorrect ? "" : currentCard.id;
    event.currentTarget.reset();
    render();
    if (isCorrect && !state.sessionComplete) {
      schedulePracticeAutoAdvance();
    }
  });

  elements.typingAnswerInput.addEventListener("input", (event) => {
    updateTypingInputWidth(event.target.value);
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
    state.submittedTypingCorrect = true;
    state.studyFeedback = "Accepted as correct.";
    state.typingAnswerPendingCardId = "";
    render();
    if (!state.sessionComplete) {
      schedulePracticeAutoAdvance();
    }
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
    state.deckView = "page";
    render();
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
    state.deckView = "page";
    event.currentTarget.reset();
    render();
  });
  elements.decksCreateNew.addEventListener("click", () => {
    if (!state.targetLanguage) {
      return;
    }

    elements.createDeckForm.reset();
    state.deckView = "create";
    render();
  });
  elements.createCardInDeck.addEventListener("click", () => {
    if (!state.selectedSettingsDeck) {
      return;
    }

    stopEditingCard();
    state.deckView = "editor";
    render();
  });
  elements.createDeckFolder.addEventListener("click", () => {
    if (!state.targetLanguage) {
      return;
    }

    const folderName = promptForFolderName("deck");
    if (!folderName) {
      return;
    }

    createCustomDeckFolder(state.targetLanguage, folderName);
    persistSettings();
    renderDeckSummary();
  });
  elements.decksBackToLibrary.addEventListener("click", () => {
    stopEditingCard();
    state.deckView = "library";
    render();
  });
  elements.decksBackToPage.addEventListener("click", () => {
    stopEditingCard();
    state.deckView = "page";
    render();
  });
  elements.libraryBackToList.addEventListener("click", () => {
    stopEditingLibraryText();
    state.libraryView = "list";
    render();
  });
  elements.libraryCreateNew.addEventListener("click", () => {
    stopEditingLibraryText();
    elements.libraryImportForm.reset();
    elements.libraryImportStatus.textContent = "Imports are cleaned automatically. PDF extraction is best effort.";
    state.libraryView = "import";
    render();
  });
  elements.libraryCreateFolder.addEventListener("click", () => {
    if (!state.targetLanguage) {
      return;
    }

    const folderName = promptForFolderName("library");
    if (!folderName) {
      return;
    }

    state.libraryTexts = [
      hydrateLibraryText({
        id: generateId(),
        kind: "folder",
        language: state.targetLanguage,
        title: folderName,
        text: "",
      }),
      ...state.libraryTexts,
    ];
    persistLibraryTexts();
    renderLibrary();
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
  elements.librarySearchInput.addEventListener("input", (event) => {
    state.librarySearch = event.target.value;
    renderLibrary();
  });
  elements.libraryVisualEditor.addEventListener("input", () => {
    syncLibraryEditTextFromVisualEditor();
    updateLibraryGrammarSelectionState();
  });
  elements.libraryVisualEditor.addEventListener("click", (event) => {
    handleLibraryVisualEditorInteraction(event.target);
    updateLibraryGrammarSelectionState();
  });
  elements.libraryVisualEditor.addEventListener("keyup", () => {
    syncLibraryEditTextFromVisualEditor();
    updateLibraryGrammarSelectionState();
  });
  elements.libraryVisualEditor.addEventListener("mouseup", () => {
    updateLibraryGrammarSelectionState();
  });
  elements.libraryVisualEditor.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      syncLibraryEditTextFromVisualEditor();
      updateLibraryGrammarSelectionState();
    }
  });
  elements.libraryGrammarLinkSelect.addEventListener("change", () => {
    renderLibraryGrammarSelectionState();
  });
  elements.applyLibraryGrammarLink.addEventListener("click", () => {
    applyLibraryGrammarLinkFromSelection();
  });
  elements.libraryActiveGrammarLinkSelect.addEventListener("change", () => {
    elements.updateLibraryGrammarLink.disabled = !elements.libraryActiveGrammarLinkSelect.value;
  });
  elements.updateLibraryGrammarLink.addEventListener("click", () => {
    updateActiveLibraryGrammarLink();
  });
  elements.removeLibraryGrammarLink.addEventListener("click", () => {
    removeActiveLibraryGrammarLink();
  });
  elements.updateLibraryTextStyle.addEventListener("click", () => {
    updateActiveLibraryTextStyle();
  });
  elements.removeLibraryTextStyle.addEventListener("click", () => {
    removeActiveLibraryTextStyle();
  });
  document.addEventListener("click", (event) => {
    if (
      state.libraryView === "editor" &&
      !elements.libraryLinkPopover.contains(event.target) &&
      !elements.libraryStylePopover.contains(event.target) &&
      !elements.libraryVisualEditor.contains(event.target)
    ) {
      state.activeLibraryGrammarToken = null;
      state.activeLibraryStyleToken = null;
      hideLibraryLinkPopover();
      hideLibraryStylePopover();
    }
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

    const activeText = getActiveLibraryText();
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
      sourceTextId: activeText?.id || "",
      sourceTextSnippet: prompt,
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
  elements.grammarCreateFolder.addEventListener("click", () => {
    if (!state.targetLanguage) {
      return;
    }

    const folderName = promptForFolderName("grammar");
    if (!folderName) {
      return;
    }

    state.grammarPoints = [
      hydrateGrammarPoint({
        id: generateId(),
        kind: "folder",
        language: state.targetLanguage,
        title: folderName,
        summary: "",
        blocks: [],
      }),
      ...state.grammarPoints,
    ];
    persistGrammarPoints();
    renderGrammar();
  });
  elements.grammarSearchInput.addEventListener("input", (event) => {
    state.grammarSearch = event.target.value;
    renderGrammar();
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

    syncLibraryEditTextFromVisualEditor();
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
    const nextPrompt = formData.get("prompt").toString().trim();
    const keepsSourceLink =
      Boolean(editingCard?.sourceTextId) &&
      normalizeText(editingCard?.prompt || "") === normalizeText(nextPrompt);
    const nextCard = hydrateCard({
      id: editingCard?.id || generateId(),
      language: state.targetLanguage,
      deck: editingCard?.deck || state.selectedSettingsDeck,
      prompt: nextPrompt,
      hint: formData.get("hint").toString().trim(),
      answer: formData.get("answer").toString().trim(),
      notes: formData.get("notes").toString().trim(),
      audio: state.importedAudio,
      sourceTextId: keepsSourceLink ? editingCard.sourceTextId : "",
      sourceTextSnippet: keepsSourceLink ? editingCard.sourceTextSnippet : "",
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
    state.deckView = "page";
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

  elements.card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".grammar-inline-link")) {
      return;
    }
    if (state.sessionComplete || state.isAdvancing || state.studyMode !== "flashcards") {
      return;
    }

    state.cardSwipePointerId = event.pointerId;
    state.cardSwipeStartX = event.clientX;
    state.cardSwipeDeltaX = 0;
    state.cardSwipeActive = false;
    state.suppressCardClick = false;
    elements.card.setPointerCapture?.(event.pointerId);
  });

  elements.card.addEventListener("pointermove", (event) => {
    if (state.cardSwipePointerId !== event.pointerId || state.sessionComplete || state.isAdvancing || state.studyMode !== "flashcards") {
      return;
    }

    state.cardSwipeDeltaX = event.clientX - state.cardSwipeStartX;
    if (Math.abs(state.cardSwipeDeltaX) > 8) {
      state.cardSwipeActive = true;
      state.suppressCardClick = true;
      event.preventDefault();
    }
    renderFlashcard();
  });

  elements.card.addEventListener("pointerup", (event) => {
    if (state.cardSwipePointerId !== event.pointerId) {
      return;
    }

    elements.card.releasePointerCapture?.(event.pointerId);
    const finalDelta = state.cardSwipeDeltaX;
    const crossedThreshold = Math.abs(finalDelta) >= 110;
    resetCardSwipeState();
    renderFlashcard();

    if (crossedThreshold) {
      state.suppressCardClick = true;
      if (finalDelta > 0) {
        updateFlashcardScore(2, true);
      } else {
        updateFlashcardScore(-1, false);
      }
      window.setTimeout(() => {
        state.suppressCardClick = false;
      }, 180);
      return;
    }

    window.setTimeout(() => {
      state.suppressCardClick = false;
    }, 0);
  });

  elements.card.addEventListener("pointercancel", () => {
    resetCardSwipeState();
    renderFlashcard();
    state.suppressCardClick = false;
  });

  elements.card.addEventListener("click", (event) => {
    if (event.target.closest(".grammar-inline-link")) {
      return;
    }
    if (state.suppressCardClick) {
      event.preventDefault();
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
