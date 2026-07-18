'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ecclesiastes-progress';
const MASTERED_THRESHOLD = 3;

const SKIP_WORDS = new Set([
  'a','an','the','of','in','to','and','or','but','for','nor','so','yet',
  'at','by','it','its','is','as','be','do','go','he','me','my','no','on',
  'up','us','we','i','am',
]);

// ── State ────────────────────────────────────────────────────────────────────

let data = null;
let currentChapter = 1;
let difficulty = 1;
let progress = {};
let studyMode = 'cloze';  // 'cloze' | 'flashcard' | 'mc'
let sessionIndex = 0;

// ── Progress ─────────────────────────────────────────────────────────────────

function progressKey(chapter, verse) { return `${chapter}:${verse}`; }

function loadProgress() {
  try { progress = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { progress = {}; }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function getVerseProgress(chapter, verse) {
  const key = progressKey(chapter, verse);
  if (!progress[key]) progress[key] = { status: 'not-started', streak: 0, attempts: 0 };
  return progress[key];
}

function statusLabel(s) {
  return s === 'mastered' ? 'Mastered' : s === 'in-progress' ? 'In progress' : 'Not started';
}

// ── Utility ──────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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

function recordVerseResult(chapter, verse, correct) {
  const vp = getVerseProgress(chapter, verse);
  vp.attempts = (vp.attempts || 0) + 1;
  if (correct) {
    vp.streak = (vp.streak || 0) + 1;
    vp.status = vp.streak >= MASTERED_THRESHOLD ? 'mastered' : 'in-progress';
  } else {
    vp.streak = 0;
    vp.status = 'in-progress';
  }
  saveProgress();
  updateProgressSummary();
  return vp;
}

// ── Mode system ──────────────────────────────────────────────────────────────

function setMode(mode) {
  studyMode = mode;
  sessionIndex = 0;
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  document.getElementById('difficulty-controls').style.display =
    mode === 'cloze' ? 'flex' : 'none';
  renderCurrentMode();
}

function renderCurrentMode() {
  updateProgressSummary();
  const chapter = data.chapters.find(c => c.chapter === currentChapter);
  if (!chapter) return;
  if (studyMode === 'cloze')     renderCloze(chapter);
  else if (studyMode === 'flashcard') renderFlashcard(chapter);
  else                           renderMC(chapter);
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

// ── Cloze mode ───────────────────────────────────────────────────────────────

function tokenize(text, chapter, verse, diff) {
  const fractions = [0, 0.20, 0.35, 0.50, 0.65, 0.80];
  const fraction = fractions[diff] || 0.20;
  const rawTokens = text.split(/(\s+|(?=[.,;:!?"()])|(?<=[.,;:!?"()]))/);
  const words = rawTokens.filter(t => /[A-Za-z']/.test(t));
  const blankable = words
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => {
      const core = w.replace(/[^A-Za-z']/g, '').toLowerCase();
      return core.length >= 3 && !SKIP_WORDS.has(core);
    });
  const seed = chapter * 1000 + verse + diff * 100;
  const shuffled = seededShuffle(blankable, seed);
  const count = Math.max(1, Math.round(shuffled.length * fraction));
  const blankIndices = new Set(shuffled.slice(0, count).map(b => b.i));
  let wordIdx = 0;
  const tokens = [];
  for (const raw of rawTokens) {
    if (!raw) continue;
    if (/[A-Za-z']/.test(raw)) {
      tokens.push(blankIndices.has(wordIdx)
        ? { type: 'blank', text: raw }
        : { type: 'text', text: raw });
      wordIdx++;
    } else {
      tokens.push({ type: 'text', text: raw });
    }
  }
  return tokens;
}

function buildVerseCard(chapterNum, verseObj) {
  const { verse, text } = verseObj;
  const vp = getVerseProgress(chapterNum, verse);
  const tokens = tokenize(text, chapterNum, verse, difficulty);
  const blanks = tokens.filter(t => t.type === 'blank');

  const card = document.createElement('div');
  card.className = `verse-card ${vp.status}`;
  card.dataset.chapter = chapterNum;
  card.dataset.verse = verse;

  const header = document.createElement('div');
  header.className = 'verse-header';
  header.innerHTML = `
    <span class="verse-num">Chapter ${chapterNum} · Verse ${verse}</span>
    <span class="verse-status ${vp.status}">${statusLabel(vp.status)}</span>
  `;
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'verse-body';

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

  const feedback = document.createElement('div');
  feedback.className = 'feedback';
  body.appendChild(feedback);

  const streakEl = document.createElement('div');
  streakEl.className = 'streak-bar';
  if (vp.streak > 0) streakEl.textContent = `Streak: ${vp.streak} / ${MASTERED_THRESHOLD}`;
  body.appendChild(streakEl);

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
    resetBtn.addEventListener('click', () => card.replaceWith(buildVerseCard(chapterNum, verseObj)));
    actions.appendChild(resetBtn);

    const revealBtn = document.createElement('button');
    revealBtn.className = 'ghost';
    revealBtn.textContent = 'Reveal';
    revealBtn.addEventListener('click', () => revealVerse(card));
    actions.appendChild(revealBtn);
  } else {
    feedback.textContent = 'Verse too short to blank — read and mark done.';
    const markBtn = document.createElement('button');
    markBtn.className = 'primary';
    markBtn.textContent = 'Mark as done';
    markBtn.addEventListener('click', () => {
      recordVerseResult(chapterNum, verse, true);
      refreshCardStatus(card);
    });
    actions.appendChild(markBtn);
  }

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

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
    const val = input.value;
    if (!val.trim()) { allCorrect = false; return; }
    anyFilled = true;
    const ok = normalize(val) === normalize(input.dataset.answer);
    input.classList.toggle('correct', ok);
    input.classList.toggle('incorrect', !ok);
    if (!ok) allCorrect = false;
  });

  if (!anyFilled) {
    setClozeFeedback(card, 'Type the missing words above, then check.', '');
    return;
  }

  const vp = recordVerseResult(chapter, verse, allCorrect);
  refreshCardStatus(card);

  if (allCorrect) {
    setClozeFeedback(card, `Correct! (${vp.streak}/${MASTERED_THRESHOLD})`, 'correct');
  } else {
    setClozeFeedback(card, 'Not quite — check the highlighted blanks.', 'wrong');
  }
}

function setClozeFeedback(card, msg, type) {
  const fb = card.querySelector('.feedback');
  fb.textContent = msg;
  fb.className = `feedback ${type}`;
  const streakEl = card.querySelector('.streak-bar');
  const vp = getVerseProgress(parseInt(card.dataset.chapter), parseInt(card.dataset.verse));
  streakEl.textContent = vp.streak > 0 ? `Streak: ${vp.streak} / ${MASTERED_THRESHOLD}` : '';
}

function refreshCardStatus(card) {
  const vp = getVerseProgress(parseInt(card.dataset.chapter), parseInt(card.dataset.verse));
  card.className = `verse-card ${vp.status}`;
  const statusEl = card.querySelector('.verse-status');
  statusEl.className = `verse-status ${vp.status}`;
  statusEl.textContent = statusLabel(vp.status);
}

function revealVerse(card) {
  const chapter = parseInt(card.dataset.chapter);
  const verse = parseInt(card.dataset.verse);
  card.querySelectorAll('.blank-word input').forEach(input => {
    if (!input.classList.contains('correct')) {
      input.value = input.dataset.answer;
      input.classList.remove('incorrect');
      input.classList.add('revealed');
    }
  });
  setClozeFeedback(card, 'Answers shown. Reset to try again.', 'partial');
  const vp = getVerseProgress(chapter, verse);
  if (vp.status === 'not-started') {
    vp.status = 'in-progress';
    vp.streak = 0;
    saveProgress();
    refreshCardStatus(card);
    updateProgressSummary();
  }
}

function renderCloze(chapter) {
  const list = document.getElementById('verse-list');
  list.innerHTML = '';
  for (const verseObj of chapter.verses) {
    list.appendChild(buildVerseCard(chapter.chapter, verseObj));
  }
}

// ── Flashcard mode ───────────────────────────────────────────────────────────

function renderFlashcard(chapter) {
  const verses = chapter.verses;
  const pairs = verses.length - 1;
  const i = Math.min(sessionIndex, pairs - 1);
  const front = verses[i];
  const back = verses[i + 1];

  const list = document.getElementById('verse-list');
  list.innerHTML = '';

  const scene = document.createElement('div');
  scene.className = 'fc-scene';

  const card = document.createElement('div');
  card.className = 'fc-card';

  const frontEl = document.createElement('div');
  frontEl.className = 'fc-face fc-front';
  frontEl.innerHTML = `
    <div class="fc-label">Chapter ${chapter.chapter} · Verse ${front.verse}</div>
    <div class="fc-text">${front.text}</div>
    <div class="fc-hint">Tap to reveal next verse →</div>
  `;

  const backEl = document.createElement('div');
  backEl.className = 'fc-face fc-back';
  backEl.innerHTML = `
    <div class="fc-label">Chapter ${chapter.chapter} · Verse ${back.verse}</div>
    <div class="fc-text">${back.text}</div>
    <div class="fc-hint">← Tap to flip back</div>
  `;

  card.appendChild(frontEl);
  card.appendChild(backEl);
  card.addEventListener('click', () => card.classList.toggle('flipped'));
  scene.appendChild(card);
  list.appendChild(scene);

  list.appendChild(buildSessionNav(
    pairs, i,
    () => { sessionIndex = Math.max(0, sessionIndex - 1); renderFlashcard(chapter); },
    () => { sessionIndex = Math.min(pairs - 1, sessionIndex + 1); renderFlashcard(chapter); },
    `Card ${i + 1} of ${pairs}`
  ));
}

// ── Multiple choice mode ─────────────────────────────────────────────────────

function renderMC(chapter) {
  const verses = chapter.verses;
  const pairs = verses.length - 1;
  const i = sessionIndex % pairs;
  const questionVerse = verses[i];
  const correctVerse = verses[i + 1];

  const pool = verses.filter((_, idx) => idx !== i && idx !== i + 1);
  const wrong = shuffleArray(pool).slice(0, 3);
  const options = shuffleArray([correctVerse, ...wrong]);

  const list = document.getElementById('verse-list');
  list.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'mc-container';

  const prompt = document.createElement('div');
  prompt.innerHTML = `
    <div class="mc-prompt-label">Chapter ${chapter.chapter} · Verse ${questionVerse.verse}</div>
    <div class="mc-prompt-text">${questionVerse.text}</div>
    <div class="mc-question">What comes next?</div>
  `;
  container.appendChild(prompt);

  const optionsEl = document.createElement('div');
  optionsEl.className = 'mc-options';

  let answered = false;

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'mc-option';
    btn.textContent = opt.text;
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;

      const correct = opt.verse === correctVerse.verse;
      btn.classList.add(correct ? 'correct' : 'wrong');

      optionsEl.querySelectorAll('.mc-option').forEach(b => {
        b.disabled = true;
        if (b.textContent === correctVerse.text) b.classList.add('correct');
      });

      recordVerseResult(chapter.chapter, questionVerse.verse, correct);
      nextBtn.style.display = '';
    });
    optionsEl.appendChild(btn);
  });

  container.appendChild(optionsEl);
  list.appendChild(container);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'primary';
  nextBtn.textContent = 'Next →';
  nextBtn.style.display = 'none';
  nextBtn.addEventListener('click', () => {
    sessionIndex = Math.min(pairs - 1, sessionIndex + 1);
    renderMC(chapter);
  });

  list.appendChild(buildSessionNav(
    pairs, i,
    () => { sessionIndex = Math.max(0, sessionIndex - 1); renderMC(chapter); },
    () => { sessionIndex = Math.min(pairs - 1, sessionIndex + 1); renderMC(chapter); },
    `Question ${i + 1} of ${pairs}`,
    nextBtn
  ));
}

// ── Shared session nav ────────────────────────────────────────────────────────

function buildSessionNav(total, i, onPrev, onNext, label, centerEl) {
  const nav = document.createElement('div');
  nav.className = 'session-nav';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '← Prev';
  prevBtn.disabled = i === 0;
  prevBtn.addEventListener('click', onPrev);

  const middle = document.createElement('div');
  middle.style.display = 'flex';
  middle.style.flexDirection = 'column';
  middle.style.alignItems = 'center';
  middle.style.gap = '6px';

  const progressEl = document.createElement('span');
  progressEl.className = 'session-progress';
  progressEl.textContent = label;
  middle.appendChild(progressEl);
  if (centerEl) middle.appendChild(centerEl);

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next →';
  nextBtn.disabled = i >= total - 1;
  nextBtn.addEventListener('click', onNext);

  nav.appendChild(prevBtn);
  nav.appendChild(middle);
  nav.appendChild(nextBtn);
  return nav;
}

// ── Chapter render ────────────────────────────────────────────────────────────

function renderChapter(chapterNum) {
  currentChapter = chapterNum;
  sessionIndex = 0;
  document.title = `Ecclesiastes ${chapterNum} — Memorize`;
  document.querySelectorAll('.chapter-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.chapter) === chapterNum);
  });
  renderCurrentMode();
}

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    loadProgress();

    data = typeof VERSES_DATA !== 'undefined'
      ? VERSES_DATA
      : await fetch('verses.json').then(r => r.json());

    const nav = document.getElementById('chapter-nav');
    for (const ch of data.chapters) {
      const btn = document.createElement('button');
      btn.className = 'chapter-btn';
      btn.dataset.chapter = ch.chapter;
      btn.textContent = `Chapter ${ch.chapter}`;
      btn.addEventListener('click', () => renderChapter(ch.chapter));
      nav.appendChild(btn);
    }

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    const slider = document.getElementById('difficulty-slider');
    slider.addEventListener('input', () => {
      setDifficulty(slider.value);
      if (studyMode === 'cloze') renderCurrentMode();
    });
    setDifficulty(slider.value);

    renderChapter(data.chapters[0].chapter);
  } catch (err) {
    document.getElementById('verse-list').innerHTML =
      `<p style="font-family:system-ui;color:#c0392b;padding:1rem;">
        Failed to load verses: ${err.message}
      </p>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
