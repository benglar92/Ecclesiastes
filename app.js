'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ecclesiastes-progress';
const MASTERED_THRESHOLD = 3; // consecutive correct to mark mastered

// Words too short/trivial to blank (articles, short prepositions, etc.)
const SKIP_WORDS = new Set([
  'a','an','the','of','in','to','and','or','but','for','nor','so','yet',
  'at','by','it','its','is','as','be','do','go','he','me','my','no','on',
  'up','us','we','i','am',
]);

// ── State ────────────────────────────────────────────────────────────────────

let data = null;        // loaded JSON
let currentChapter = 1;
let difficulty = 1;     // 1 = few blanks … 5 = many blanks
let progress = {};      // { "1:3": { status, streak, attempts } }

// ── Utility ──────────────────────────────────────────────────────────────────

function progressKey(chapter, verse) {
  return `${chapter}:${verse}`;
}

function loadProgress() {
  try {
    progress = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { progress = {}; }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function getVerseProgress(chapter, verse) {
  const key = progressKey(chapter, verse);
  if (!progress[key]) {
    progress[key] = { status: 'not-started', streak: 0, attempts: 0 };
  }
  return progress[key];
}

function statusLabel(status) {
  return status === 'mastered' ? 'Mastered'
       : status === 'in-progress' ? 'In progress'
       : 'Not started';
}

// ── Blank selection ──────────────────────────────────────────────────────────

/**
 * Given verse text and difficulty (1-5), return an array of token objects:
 *   { type: 'text'|'blank', text: string, index?: number }
 *
 * Difficulty maps to a fraction of "blankable" words to hide:
 *   1 → ~20%  2 → ~35%  3 → ~50%  4 → ~65%  5 → ~80%
 */
function tokenize(text, chapter, verse, diff) {
  const fractions = [0, 0.20, 0.35, 0.50, 0.65, 0.80];
  const fraction = fractions[diff] || 0.20;

  // Split on word boundaries, keeping spaces and punctuation as separate tokens
  const rawTokens = text.split(/(\s+|(?=[.,;:!?"()])|(?<=[.,;:!?"()]))/);
  const words = rawTokens.filter(t => /[A-Za-z']/.test(t));

  // Determine which words are blankable
  const blankable = words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => {
      const core = w.replace(/[^A-Za-z']/g, '').toLowerCase();
      return core.length >= 3 && !SKIP_WORDS.has(core);
    });

  // Stable shuffle seeded per verse so blanks don't change on re-render
  const seed = chapter * 1000 + verse + diff * 100;
  const shuffled = seededShuffle(blankable, seed);
  const count = Math.max(1, Math.round(shuffled.length * fraction));
  const blankIndices = new Set(shuffled.slice(0, count).map(b => b.i));

  // Build token list, re-splitting on the word index
  let wordIdx = 0;
  const tokens = [];
  for (const raw of rawTokens) {
    if (!raw) continue;
    if (/[A-Za-z']/.test(raw)) {
      if (blankIndices.has(wordIdx)) {
        tokens.push({ type: 'blank', text: raw });
      } else {
        tokens.push({ type: 'text', text: raw });
      }
      wordIdx++;
    } else {
      tokens.push({ type: 'text', text: raw });
    }
  }
  return tokens;
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Render helpers ───────────────────────────────────────────────────────────

function buildVerseCard(chapterNum, verseObj) {
  const { verse, text } = verseObj;
  const vp = getVerseProgress(chapterNum, verse);
  const tokens = tokenize(text, chapterNum, verse, difficulty);
  const blanks = tokens.filter(t => t.type === 'blank');

  const card = document.createElement('div');
  card.className = `verse-card ${vp.status}`;
  card.dataset.chapter = chapterNum;
  card.dataset.verse = verse;

  // Header
  const header = document.createElement('div');
  header.className = 'verse-header';
  header.innerHTML = `
    <span class="verse-num">Chapter ${chapterNum} · Verse ${verse}</span>
    <span class="verse-status ${vp.status}">${statusLabel(vp.status)}</span>
  `;
  card.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'verse-body';

  // Verse text with blanks
  const verseTextEl = document.createElement('div');
  verseTextEl.className = 'verse-text';

  let blankCount = 0;
  for (const token of tokens) {
    if (token.type === 'text') {
      verseTextEl.appendChild(document.createTextNode(token.text));
    } else {
      const span = document.createElement('span');
      span.className = 'blank-word';
      const charWidth = Math.max(token.text.length, 4);
      const input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.autocorrect = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.style.setProperty('--input-width', `${charWidth * 0.62 + 1}em`);
      input.dataset.answer = token.text;
      input.dataset.blankIdx = blankCount++;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitVerse(card);
      });
      span.appendChild(input);
      verseTextEl.appendChild(span);
    }
  }
  body.appendChild(verseTextEl);

  // Feedback line
  const feedback = document.createElement('div');
  feedback.className = 'feedback';
  body.appendChild(feedback);

  // Streak
  const streak = document.createElement('div');
  streak.className = 'streak-bar';
  if (vp.streak > 0) {
    streak.textContent = `Streak: ${vp.streak} / ${MASTERED_THRESHOLD}`;
  }
  body.appendChild(streak);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'verse-actions';

  if (blanks.length > 0) {
    const checkBtn = document.createElement('button');
    checkBtn.className = 'primary';
    checkBtn.textContent = 'Check';
    checkBtn.addEventListener('click', () => submitVerse(card));
    actions.appendChild(checkBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => resetVerse(card, chapterNum, verseObj));
    actions.appendChild(resetBtn);

    const revealBtn = document.createElement('button');
    revealBtn.className = 'ghost';
    revealBtn.textContent = 'Reveal';
    revealBtn.addEventListener('click', () => revealVerse(card));
    actions.appendChild(revealBtn);
  } else {
    // All words were skipped (very short verse); show full text
    feedback.textContent = 'Verse too short to blank — read and mark done.';
    const markBtn = document.createElement('button');
    markBtn.className = 'primary';
    markBtn.textContent = 'Mark as done';
    markBtn.addEventListener('click', () => {
      recordResult(chapterNum, verse, true, card);
    });
    actions.appendChild(markBtn);
  }

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

// ── Check / submit ───────────────────────────────────────────────────────────

function normalize(str) {
  return str.trim().toLowerCase().replace(/[^a-z']/g, '');
}

function submitVerse(card) {
  const chapter = parseInt(card.dataset.chapter);
  const verse = parseInt(card.dataset.verse);
  const inputs = card.querySelectorAll('.blank-word input');
  let allCorrect = true;
  let anyFilled = false;

  inputs.forEach(input => {
    if (input.classList.contains('revealed')) return;
    const answer = input.dataset.answer;
    const val = input.value;
    if (!val.trim()) { allCorrect = false; return; }
    anyFilled = true;
    const ok = normalize(val) === normalize(answer);
    input.classList.toggle('correct', ok);
    input.classList.toggle('incorrect', !ok);
    if (!ok) allCorrect = false;
  });

  if (!anyFilled) {
    setFeedback(card, 'Type the missing words above, then check.', '');
    return;
  }

  recordResult(chapter, verse, allCorrect, card);
}

function recordResult(chapter, verse, allCorrect, card) {
  const vp = getVerseProgress(chapter, verse);
  vp.attempts = (vp.attempts || 0) + 1;

  if (allCorrect) {
    vp.streak = (vp.streak || 0) + 1;
    if (vp.streak >= MASTERED_THRESHOLD) {
      vp.status = 'mastered';
    } else {
      vp.status = 'in-progress';
    }
    setFeedback(card, allCorrect ? `Correct! (${vp.streak}/${MASTERED_THRESHOLD})` : 'Done!', 'correct');
  } else {
    vp.streak = 0;
    vp.status = 'in-progress';
    setFeedback(card, 'Not quite — check the highlighted blanks.', 'wrong');
  }

  saveProgress();
  refreshCardStatus(card, vp);
  updateProgressSummary();
}

function setFeedback(card, msg, type) {
  const fb = card.querySelector('.feedback');
  fb.textContent = msg;
  fb.className = `feedback ${type}`;
  const streak = card.querySelector('.streak-bar');
  const chapter = parseInt(card.dataset.chapter);
  const verse = parseInt(card.dataset.verse);
  const vp = getVerseProgress(chapter, verse);
  streak.textContent = vp.streak > 0 ? `Streak: ${vp.streak} / ${MASTERED_THRESHOLD}` : '';
}

function refreshCardStatus(card, vp) {
  card.className = `verse-card ${vp.status}`;
  const statusEl = card.querySelector('.verse-status');
  statusEl.className = `verse-status ${vp.status}`;
  statusEl.textContent = statusLabel(vp.status);
}

function revealVerse(card) {
  const inputs = card.querySelectorAll('.blank-word input');
  inputs.forEach(input => {
    if (!input.classList.contains('correct')) {
      input.value = input.dataset.answer;
      input.classList.remove('incorrect');
      input.classList.add('revealed');
    }
  });
  setFeedback(card, 'Answers shown. Reset to try again.', 'partial');
  const chapter = parseInt(card.dataset.chapter);
  const verse = parseInt(card.dataset.verse);
  const vp = getVerseProgress(chapter, verse);
  if (vp.status === 'not-started') {
    vp.status = 'in-progress';
    vp.streak = 0;
    saveProgress();
    refreshCardStatus(card, vp);
    updateProgressSummary();
  }
}

function resetVerse(card, chapter, verseObj) {
  const newCard = buildVerseCard(chapter, verseObj);
  card.replaceWith(newCard);
}

// ── Progress summary ─────────────────────────────────────────────────────────

function updateProgressSummary() {
  const chapter = data.chapters.find(c => c.chapter === currentChapter);
  if (!chapter) return;
  let mastered = 0, inProgress = 0, notStarted = 0;
  for (const v of chapter.verses) {
    const vp = getVerseProgress(currentChapter, v.verse);
    if (vp.status === 'mastered') mastered++;
    else if (vp.status === 'in-progress') inProgress++;
    else notStarted++;
  }
  const total = chapter.verses.length;
  document.getElementById('summary-mastered').textContent = `${mastered} mastered`;
  document.getElementById('summary-progress').textContent = `${inProgress} in progress`;
  document.getElementById('summary-new').textContent = `${notStarted} new`;
}

// ── Difficulty ───────────────────────────────────────────────────────────────

const DIFF_LABELS = ['', 'Beginner (few blanks)', 'Easy', 'Medium', 'Hard', 'Expert (many blanks)'];

function setDifficulty(val) {
  difficulty = parseInt(val);
  document.getElementById('difficulty-label').textContent = DIFF_LABELS[difficulty] || '';
}

// ── Render chapter ───────────────────────────────────────────────────────────

function renderChapter(chapterNum) {
  currentChapter = chapterNum;
  const chapter = data.chapters.find(c => c.chapter === chapterNum);
  if (!chapter) return;

  document.title = `Ecclesiastes ${chapterNum} — Memorize`;

  // Update nav buttons
  document.querySelectorAll('.chapter-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.chapter) === chapterNum);
  });

  const list = document.getElementById('verse-list');
  list.innerHTML = '';
  for (const verseObj of chapter.verses) {
    list.appendChild(buildVerseCard(chapterNum, verseObj));
  }
  updateProgressSummary();
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  loadProgress();

  data = VERSES_DATA;

  // Build chapter nav
  const nav = document.getElementById('chapter-nav');
  for (const ch of data.chapters) {
    const btn = document.createElement('button');
    btn.className = 'chapter-btn';
    btn.dataset.chapter = ch.chapter;
    btn.textContent = `Chapter ${ch.chapter}`;
    btn.addEventListener('click', () => renderChapter(ch.chapter));
    nav.appendChild(btn);
  }

  // Difficulty slider
  const slider = document.getElementById('difficulty-slider');
  slider.addEventListener('input', () => {
    setDifficulty(slider.value);
    renderChapter(currentChapter);
  });
  setDifficulty(slider.value);

  renderChapter(data.chapters[0].chapter);
}

document.addEventListener('DOMContentLoaded', init);
