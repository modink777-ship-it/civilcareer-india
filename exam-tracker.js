/* CivilCareer Exam Tracker — standalone page controller. */
(() => {
  'use strict';

  const API = '/api/exam-tracker';
  const SAVED_KEY = 'cc_exam_tracker_saved_v1';
  const ALERTED_KEY = 'cc_exam_tracker_alerted_v1';
  const CACHE_KEY = 'cc_exam_tracker_cache_v1';
  const CACHE_TTL = 5 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(String) : [];
    } catch (_) {
      return [];
    }
  }

  function writeArray(key, value) {
    try { localStorage.setItem(key, JSON.stringify([...new Set(value.map(String))])); } catch (_) {}
  }

  let exams = [];
  let category = '';
  let saved = readArray(SAVED_KEY);
  let alerted = readArray(ALERTED_KEY);
  let alertExamId = '';

  const STATUS = {
    upcoming: { label: 'Upcoming', cls: 'upcoming' },
    application_open: { label: 'Application Open', cls: 'application-open' },
    application_closed: { label: 'Application Closed', cls: 'application-closed' },
    result_out: { label: 'Result Out', cls: 'result-out' },
    notification_out: { label: 'Notification Out', cls: 'notification-out' },
    admit_card: { label: 'Admit Card', cls: 'admit-card' },
    exam_scheduled: { label: 'Exam Scheduled', cls: 'exam-scheduled' },
  };

  function statusMeta(status) {
    return STATUS[String(status || '').toLowerCase()] || STATUS.upcoming;
  }

  function fmtDate(value) {
    if (!value) return 'Not announced';
    const raw = String(value).slice(0, 10);
    const date = new Date(raw + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function categoryLabel(value) {
    return value === 'STATE_PSC' ? 'State PSC' : (value || 'Exam');
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return /^https?:$/i.test(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function card(exam) {
    const meta = statusMeta(exam.status);
    const isSaved = saved.includes(String(exam.id));
    const isAlerted = alerted.includes(String(exam.id));
    const official = safeExternalUrl(exam.official_url);
    const dates = [
      ['Notification', exam.notification_date],
      ['Applications', exam.application_start && exam.application_end
        ? fmtDate(exam.application_start) + ' – ' + fmtDate(exam.application_end)
        : (exam.application_start ? fmtDate(exam.application_start) : exam.application_end ? 'Ends ' + fmtDate(exam.application_end) : '')],
      ['Exam', exam.exam_date],
      ['Result', exam.result_date],
    ].filter((row) => row[1]);

    return `
      <article class="exam-card" data-exam-id="${esc(exam.id)}">
        <div class="card-top">
          <span class="exam-status ${meta.cls}"><i aria-hidden="true"></i>${esc(meta.label)}</span>
          <span class="pill">${esc(categoryLabel(exam.category))}</span>
        </div>
        <button
          class="btn-save exam-save ${isSaved ? 'saved' : ''}"
          type="button"
          data-save-exam="${esc(exam.id)}"
          aria-label="${isSaved ? 'Remove from My Exams' : 'Save to My Exams'}"
          title="${isSaved ? 'Remove from My Exams' : 'Save to My Exams'}"
        >${isSaved ? '★' : '☆'}</button>
        <h3>${esc(exam.name || 'Civil Engineering Exam')}</h3>
        <p class="organization">${esc(exam.authority || '')}</p>
        ${dates.length ? `
          <div class="exam-date-list">
            ${dates.map(([label, value]) => `<div><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}
          </div>` : ''}
        <div class="card-meta">
          ${exam.vacancy_count != null ? `<span>Vacancies: ${esc(Number(exam.vacancy_count).toLocaleString('en-IN'))}</span>` : ''}
          ${exam.exam_fee ? `<span>Fee: ${esc(exam.exam_fee)}</span>` : ''}
          ${exam.age_limit ? `<span>Age: ${esc(exam.age_limit)}</span>` : ''}
        </div>
        ${exam.eligibility_summary ? `<p class="card-copy"><strong>Eligibility:</strong> ${esc(exam.eligibility_summary)}</p>` : ''}
        ${exam.qualification ? `<p class="card-copy"><strong>Qualification:</strong> ${esc(exam.qualification)}</p>` : ''}
        <div class="card-actions">
          <button class="btn primary" type="button" data-alert-exam="${esc(exam.id)}" ${isAlerted ? 'disabled' : ''}>
            ${isAlerted ? '✓ Alert Me' : 'Alert Me'}
          </button>
          ${official ? `<a class="text-link" href="${esc(official)}" target="_blank" rel="noopener noreferrer">Official Site ↗</a>` : ''}
        </div>
      </article>
    `;
  }

  function visibleExams() {
    return category ? exams.filter((exam) => String(exam.category || '') === category) : exams;
  }

  function render() {
    const visible = visibleExams();
    const savedIds = new Set(saved);
    const savedExams = exams.filter((exam) => savedIds.has(String(exam.id)));

    $('myExamsSection').hidden = savedExams.length === 0;
    $('myExamsGrid').innerHTML = savedExams.length
      ? savedExams.map(card).join('')
      : '';

    $('examCount').textContent = exams.length
      ? `${visible.length} exam${visible.length === 1 ? '' : 's'} shown`
      : '';

    $('examGrid').innerHTML = visible.length
      ? visible.map(card).join('')
      : '<div class="empty-state"><h3>No exams in this category</h3><p>Try another category or check back when new notifications are added.</p></div>';
  }

  function cacheRead() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      return cached && Array.isArray(cached.exams) && Date.now() - cached.at < CACHE_TTL
        ? cached.exams
        : null;
    } catch (_) {
      return null;
    }
  }

  function cacheWrite(value) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), exams: value }));
    } catch (_) {}
  }

  async function loadExams() {
    const cached = cacheRead();
    if (cached) {
      exams = cached;
      render();
      return;
    }

    try {
      const response = await fetch(API, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load exams.');
      exams = Array.isArray(data.exams) ? data.exams : [];
      cacheWrite(exams);
      render();
    } catch (error) {
      $('examGrid').innerHTML =
        '<div class="empty-state"><h3>Could not load the exam tracker</h3>' +
        '<p>' + esc(error.message || 'Please try again.') + '</p>' +
        '<button class="btn secondary" type="button" id="retryExams">Retry</button></div>';
      $('examCount').textContent = '';
    }
  }

  function openAlert(examId) {
    const exam = exams.find((item) => String(item.id) === String(examId));
    if (!exam || !$('alertDialog')) return;
    alertExamId = String(exam.id);
    $('alertExamName').textContent = exam.name || '';
    $('alertForm').hidden = false;
    $('alertSuccess').hidden = true;
    $('alertStatus').className = 'form-status';
    $('alertStatus').textContent = '';
    $('alertDialog').showModal();
    $('alertName').focus();
  }

  function closeAlert() {
    const dialog = $('alertDialog');
    if (dialog && dialog.open) dialog.close();
  }

  function normalizeWhatsApp(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.replace(/^91(?=\d{10}$)/, '');
    return /^[6-9]\d{9}$/.test(local) ? '+91' + local : null;
  }

  async function submitAlert(event) {
    event.preventDefault();
    const name = $('alertName').value.trim();
    const whatsapp = normalizeWhatsApp($('alertWhatsApp').value);
    const email = $('alertEmail').value.trim();

    if (!name) {
      $('alertStatus').className = 'form-status show error';
      $('alertStatus').textContent = 'Please enter your name.';
      return;
    }
    if (!whatsapp) {
      $('alertStatus').className = 'form-status show error';
      $('alertStatus').textContent = 'Please enter a valid 10-digit Indian WhatsApp number.';
      return;
    }

    const button = $('alertForm').querySelector('button[type="submit"]');
    button.disabled = true;
    $('alertStatus').className = 'form-status show';
    $('alertStatus').textContent = 'Saving…';

    try {
      const response = await fetch('/api/exam-alert-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, whatsapp, email, exam_id: alertExamId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save your alert.');

      alerted = [...new Set([...alerted, alertExamId])];
      writeArray(ALERTED_KEY, alerted);
      $('alertForm').hidden = true;
      $('alertSuccess').hidden = false;
      render();
      toast('Exam alert saved.');
    } catch (error) {
      $('alertStatus').className = 'form-status show error';
      $('alertStatus').textContent = error.message || 'Could not save your alert.';
    } finally {
      button.disabled = false;
    }
  }

  function wireHeader() {
    const menu = $('menuBtn');
    const nav = $('mainNav');
    if (menu && nav) {
      menu.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      nav.addEventListener('click', (event) => {
        if (event.target.closest('a')) {
          nav.classList.remove('open');
          menu.setAttribute('aria-expanded', 'false');
        }
      });
    }

    document.querySelectorAll('.lang-option[data-lang]').forEach((button) => {
      button.addEventListener('click', () => {
        const lang = button.getAttribute('data-lang') || 'en';
        if (typeof window.applyLanguage === 'function') window.applyLanguage(lang);
      });
    });
  }

  document.addEventListener('click', (event) => {
    const saveButton = event.target.closest('[data-save-exam]');
    if (saveButton) {
      const id = String(saveButton.getAttribute('data-save-exam'));
      saved = saved.includes(id) ? saved.filter((value) => value !== id) : [...saved, id];
      writeArray(SAVED_KEY, saved);
      render();
      toast(saved.includes(id) ? 'Saved to My Exams.' : 'Removed from My Exams.');
      return;
    }

    const alertButton = event.target.closest('[data-alert-exam]');
    if (alertButton && !alertButton.disabled) {
      openAlert(alertButton.getAttribute('data-alert-exam'));
      return;
    }

    if (event.target.closest('#retryExams')) {
      sessionStorage.removeItem(CACHE_KEY);
      loadExams();
    }
  });

  $('examFilters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    category = button.getAttribute('data-category') || '';
    $('examFilters').querySelectorAll('[data-category]').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-selected', item === button ? 'true' : 'false');
    });
    render();
  });

  $('clearSaved').addEventListener('click', () => {
    saved = [];
    writeArray(SAVED_KEY, saved);
    render();
    toast('My Exams cleared.');
  });

  $('alertForm').addEventListener('submit', submitAlert);
  $('alertDialog').addEventListener('click', (event) => {
    if (event.target.matches('[data-close]') || event.target === $('alertDialog')) closeAlert();
  });
  $('alertDialog').addEventListener('close', () => {
    alertExamId = '';
  });

  wireHeader();
  render();
  loadExams();
})();
