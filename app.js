(function () {
  'use strict';

  // --- 1. Service Worker Registration ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => console.log('Service Worker active:', reg.scope))
        .catch((err) => console.warn('Service Worker registration failed:', err));
    });
  }

  // --- 2. Default Configuration & State ---
  const DEFAULT_SETTINGS = {
    mode: 'exam', // 'exam' | 'practice'
    timerType: 'global', // 'global' | 'stopwatch' | 'none'
    durationMinutes: 45,
    markCorrect: 1.0,
    markNegative: 0.25,
    topicFilter: 'all',
    shuffle: 'no',
    theme: 'light',
    fontSize: 'standard'
  };

  let state = {
    settings: { ...DEFAULT_SETTINGS },
    activeQuestions: [],
    currentIndex: 0,
    userAnswers: {},  // { [qId]: selectedIndex }
    statuses: {},     // { [qId]: 'unvisited' | 'unanswered' | 'answered' | 'marked' | 'ans-marked' }
    timeRemaining: 0,
    timeElapsed: 0,
    timerInterval: null,
    isSubmitted: false
  };

  // --- 3. DOM Selectors ---
  const elTimerDisplay = document.getElementById('timerDisplay');
  const elWorkspace = document.getElementById('examWorkspace');
  const elResults = document.getElementById('resultsWorkspace');
  const elQText = document.getElementById('qText');
  const elOptions = document.getElementById('optionsContainer');
  const elExplanation = document.getElementById('explanationContainer');
  const elQCounter = document.getElementById('qCounter');
  const elQTopic = document.getElementById('qTopicBadge');
  const elPaletteGrid = document.getElementById('paletteGrid');

  // Modals & Setting Elements
  const modalSettings = document.getElementById('settingsModal');
  const selectTheme = document.getElementById('settingTheme');
  const selectFont = document.getElementById('settingFontSize');
  const selectMode = document.getElementById('settingMode');
  const selectTimerType = document.getElementById('settingTimerType');
  const inputDuration = document.getElementById('settingDuration');
  const inputMarkCorrect = document.getElementById('settingMarksCorrect');
  const inputMarkNegative = document.getElementById('settingNegativeMarks');
  const selectTopic = document.getElementById('settingTopicFilter');
  const selectShuffle = document.getElementById('settingShuffleQ');

  // --- 4. Initialization Lifecycle ---
  async function init() {
    loadSettings();
    applyAppearance();

    // Ensure Question Bank is loaded asynchronously if loadQuestionBank is defined
    if (typeof window.loadQuestionBank === 'function') {
      try {
        await window.loadQuestionBank();
      } catch (err) {
        console.error('Error executing loadQuestionBank:', err);
      }
    }

    // Fallback check if dataset exists on window
    if (!window.QUESTION_BANK || !window.QUESTION_BANK.length) {
      elQText.textContent = 'Failed to load questions. Ensure geography_questions.json exists in root.';
      return;
    }

    populateTopicOptions();
    bindEvents();
    startNewSession();
  }

  function loadSettings() {
    const saved = localStorage.getItem('wc_settings');
    if (saved) {
      try {
        state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch (e) {
        state.settings = { ...DEFAULT_SETTINGS };
      }
    }
  }

  function saveSettings() {
    localStorage.setItem('wc_settings', JSON.stringify(state.settings));
  }

  function applyAppearance() {
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    document.documentElement.setAttribute('data-font-size', state.settings.fontSize);
  }

  function populateTopicOptions() {
    const topics = Array.from(new Set(window.QUESTION_BANK.map((q) => q.topic))).filter(Boolean);
    selectTopic.innerHTML = '<option value="all">All Topics (Full Bank - ' + window.QUESTION_BANK.length + ' Qs)</option>';
    topics.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      selectTopic.appendChild(opt);
    });
  }

  // --- 5. Session Generator ---
  function startNewSession() {
    clearInterval(state.timerInterval);
    state.isSubmitted = false;

    // Filter question set
    let pool = [...window.QUESTION_BANK];
    if (state.settings.topicFilter !== 'all') {
      pool = pool.filter((q) => q.topic === state.settings.topicFilter);
    }

    // Randomize if requested
    if (state.settings.shuffle === 'yes') {
      pool.sort(() => Math.random() - 0.5);
    }

    state.activeQuestions = pool;
    state.currentIndex = 0;
    state.userAnswers = {};
    state.statuses = {};
    state.timeElapsed = 0;

    // Initialize all statuses
    state.activeQuestions.forEach((q) => {
      state.statuses[q.id] = 'unvisited';
    });

    if (state.activeQuestions.length > 0) {
      state.statuses[state.activeQuestions[0].id] = 'unanswered';
    }

    // Timer Setup
    state.timeRemaining = state.settings.durationMinutes * 60;
    setupTimer();

    // View Switching
    elResults.classList.add('hidden');
    elWorkspace.classList.remove('hidden');
    renderQuestion();
    renderPalette();
  }

  // --- 6. Timer Engine ---
  function setupTimer() {
    updateTimerUI();
    if (state.settings.timerType === 'none') {
      elTimerDisplay.textContent = 'Untimed';
      return;
    }

    state.timerInterval = setInterval(() => {
      state.timeElapsed++;

      if (state.settings.timerType === 'global') {
        state.timeRemaining--;
        if (state.timeRemaining <= 0) {
          clearInterval(state.timerInterval);
          alert('Exam duration elapsed. Auto-submitting your test.');
          submitTest();
          return;
        }
      }
      updateTimerUI();
    }, 1000);
  }

  function updateTimerUI() {
    if (state.settings.timerType === 'global') {
      const mins = Math.floor(state.timeRemaining / 60);
      const secs = state.timeRemaining % 60;
      elTimerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else if (state.settings.timerType === 'stopwatch') {
      const mins = Math.floor(state.timeElapsed / 60);
      const secs = state.timeElapsed % 60;
      elTimerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  // --- 7. Question & Option Renderer ---
  function renderQuestion() {
    const q = state.activeQuestions[state.currentIndex];
    if (!q) return;

    elQCounter.textContent = `Q ${state.currentIndex + 1} of ${state.activeQuestions.length}`;
    elQTopic.textContent = `${q.topic} • ${q.subtopic || 'General'}`;
    elQText.textContent = q.question;

    elOptions.innerHTML = '';
    const selectedIdx = state.userAnswers[q.id];

    q.options.forEach((optText, index) => {
      const optDiv = document.createElement('div');
      optDiv.className = 'option-item';
      optDiv.innerHTML = `<strong>${String.fromCharCode(65 + index)}.</strong> <span>${optText}</span>`;

      if (selectedIdx === index) {
        optDiv.classList.add('selected');
      }

      // Quiz Practice mode instant feedback
      if (state.settings.mode === 'practice' && selectedIdx !== undefined) {
        if (index === q.correctIndex) {
          optDiv.classList.add('correct');
        } else if (selectedIdx === index) {
          optDiv.classList.add('incorrect');
        }
      }

      optDiv.addEventListener('click', () => handleOptionSelect(index));
      elOptions.appendChild(optDiv);
    });

    // Practice / Review Explanations
    if (state.settings.mode === 'practice' && selectedIdx !== undefined) {
      elExplanation.classList.remove('hidden');
      elExplanation.innerHTML = `<strong>Explanation:</strong> ${q.explanation}`;
    } else {
      elExplanation.classList.add('hidden');
      elExplanation.innerHTML = '';
    }
  }

  function handleOptionSelect(idx) {
    if (state.isSubmitted && state.settings.mode !== 'practice') return;

    const q = state.activeQuestions[state.currentIndex];
    state.userAnswers[q.id] = idx;

    if (state.statuses[q.id] === 'marked') {
      state.statuses[q.id] = 'ans-marked';
    } else {
      state.statuses[q.id] = 'answered';
    }

    renderQuestion();
    renderPalette();
  }

  // --- 8. Palette Grid Navigation ---
  function renderPalette() {
    elPaletteGrid.innerHTML = '';
    state.activeQuestions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.className = `palette-btn ${state.statuses[q.id]}`;
      if (idx === state.currentIndex) btn.classList.add('active');
      btn.textContent = idx + 1;
      btn.title = `Jump to Question ${idx + 1}`;
      btn.addEventListener('click', () => jumpToQuestion(idx));
      elPaletteGrid.appendChild(btn);
    });
  }

  function jumpToQuestion(targetIndex) {
    const currentQ = state.activeQuestions[state.currentIndex];
    if (state.statuses[currentQ.id] === 'unvisited') {
      state.statuses[currentQ.id] = 'unanswered';
    }

    state.currentIndex = targetIndex;
    const targetQ = state.activeQuestions[targetIndex];
    if (state.statuses[targetQ.id] === 'unvisited') {
      state.statuses[targetQ.id] = 'unanswered';
    }

    renderQuestion();
    renderPalette();
  }

  // --- 9. Event Listeners & Actions ---
  function bindEvents() {
    document.getElementById('btnNext').addEventListener('click', () => {
      if (state.currentIndex < state.activeQuestions.length - 1) {
        jumpToQuestion(state.currentIndex + 1);
      }
    });

    document.getElementById('btnPrev').addEventListener('click', () => {
      if (state.currentIndex > 0) {
        jumpToQuestion(state.currentIndex - 1);
      }
    });

    document.getElementById('btnClear').addEventListener('click', () => {
      const q = state.activeQuestions[state.currentIndex];
      delete state.userAnswers[q.id];
      state.statuses[q.id] = 'unanswered';
      renderQuestion();
      renderPalette();
    });

    document.getElementById('btnMark').addEventListener('click', () => {
      const q = state.activeQuestions[state.currentIndex];
      if (state.userAnswers[q.id] !== undefined) {
        state.statuses[q.id] = 'ans-marked';
      } else {
        state.statuses[q.id] = 'marked';
      }
      renderPalette();
    });

    document.getElementById('btnEndTest').addEventListener('click', () => {
      const attempted = Object.keys(state.userAnswers).length;
      const total = state.activeQuestions.length;
      const confirmMsg = `Are you sure you want to submit?\n\nAttempted: ${attempted}\nUnattempted: ${total - attempted}`;
      if (confirm(confirmMsg)) {
        submitTest();
      }
    });

    // Settings Modal Handlers
    document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
    document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
    document.getElementById('btnSaveSettings').addEventListener('click', applySettingsFromForm);
    document.getElementById('btnClearStorage').addEventListener('click', () => {
      if (confirm('Reset portal configuration and restore default settings?')) {
        localStorage.removeItem('wc_settings');
        state.settings = { ...DEFAULT_SETTINGS };
        applyAppearance();
        closeSettingsModal();
        startNewSession();
      }
    });

    // Scorecard Post-Actions
    document.getElementById('btnRetake').addEventListener('click', startNewSession);
    document.getElementById('btnReviewPractice').addEventListener('click', () => {
      state.settings.mode = 'practice';
      elResults.classList.add('hidden');
      elWorkspace.classList.remove('hidden');
      state.currentIndex = 0;
      renderQuestion();
      renderPalette();
    });
  }

  // --- 10. Settings Configuration Modal ---
  function openSettingsModal() {
    selectMode.value = state.settings.mode;
    selectTimerType.value = state.settings.timerType;
    inputDuration.value = state.settings.durationMinutes;
    inputMarkCorrect.value = state.settings.markCorrect;
    inputMarkNegative.value = state.settings.markNegative;
    selectTopic.value = state.settings.topicFilter;
    selectShuffle.value = state.settings.shuffle;
    selectTheme.value = state.settings.theme;
    selectFont.value = state.settings.fontSize;

    modalSettings.classList.remove('hidden');
  }

  function closeSettingsModal() {
    modalSettings.classList.add('hidden');
  }

  function applySettingsFromForm() {
    state.settings.mode = selectMode.value;
    state.settings.timerType = selectTimerType.value;
    state.settings.durationMinutes = parseFloat(inputDuration.value) || 45;
    state.settings.markCorrect = parseFloat(inputMarkCorrect.value) || 1;
    state.settings.markNegative = parseFloat(inputMarkNegative.value) || 0;
    state.settings.topicFilter = selectTopic.value;
    state.settings.shuffle = selectShuffle.value;
    state.settings.theme = selectTheme.value;
    state.settings.fontSize = selectFont.value;

    saveSettings();
    applyAppearance();
    closeSettingsModal();
    startNewSession();
  }

  // --- 11. Test Evaluation & Analytics ---
  function submitTest() {
    clearInterval(state.timerInterval);
    state.isSubmitted = true;

    let score = 0;
    let correctCount = 0;
    let wrongCount = 0;
    const topicStats = {};

    state.activeQuestions.forEach((q) => {
      if (!topicStats[q.topic]) {
        topicStats[q.topic] = { total: 0, correct: 0, wrong: 0 };
      }
      topicStats[q.topic].total++;

      const ans = state.userAnswers[q.id];
      if (ans !== undefined) {
        if (ans === q.correctIndex) {
          correctCount++;
          score += state.settings.markCorrect;
          topicStats[q.topic].correct++;
        } else {
          wrongCount++;
          score -= state.settings.markNegative;
          topicStats[q.topic].wrong++;
        }
      }
    });

    const attemptedCount = correctCount + wrongCount;
    const accuracy = attemptedCount > 0 ? ((correctCount / attemptedCount) * 100).toFixed(1) : '0.0';

    // Update Result Scorecard
    document.getElementById('metricScore').textContent = score.toFixed(2);
    document.getElementById('metricAccuracy').textContent = `${accuracy}%`;
    document.getElementById('metricAttempted').textContent = `${attemptedCount} / ${state.activeQuestions.length}`;

    const mins = Math.floor(state.timeElapsed / 60);
    const secs = state.timeElapsed % 60;
    document.getElementById('metricTime').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Diagnostic Topic Breakdown Table
    const tbody = document.querySelector('#topicAnalysisTable tbody');
    tbody.innerHTML = '';
    Object.keys(topicStats).forEach((topic) => {
      const st = topicStats[topic];
      const attemptedInTopic = st.correct + st.wrong;
      const topicAcc = attemptedInTopic > 0 ? ((st.correct / attemptedInTopic) * 100).toFixed(0) : '0';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${topic}</strong></td>
        <td>${st.total}</td>
        <td style="color:var(--color-answered); font-weight:600;">${st.correct}</td>
        <td style="color:var(--color-unanswered); font-weight:600;">${st.wrong}</td>
        <td>${topicAcc}%</td>
      `;
      tbody.appendChild(tr);
    });

    elWorkspace.classList.add('hidden');
    elResults.classList.remove('hidden');
  }

  // Run on DOM Ready
  document.addEventListener('DOMContentLoaded', init);
})();
