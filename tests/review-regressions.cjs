const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const appFile = path.join(root, 'index.html');
const html = fs.readFileSync(appFile, 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const names = ['state', 'BUNDLED_BOOKS', 'normalizeSettings', 'normalizeWords', 'normalizeSession',
  'upgradeSession', 'sessionCounts', 'highlightWord', 'dbRequest', 'loadBookById', 'withBundledMetadata',
  'saveActivity', 'advanceStage', 'statsQuizIsValid', 'renderStatsQuiz', 'answerStatsQuiz',
  'nextStatsQuizQuestion', 'renderReview', 'playRemotePronunciation', 'stopPronunciationPlayback', 'localDate', 'answerQuiz', 'answerSpelling',
  'analysisHTML', 'wordDetailHTML', 'reviewDetailHTML', 'BUNDLED_LOOKUP_HEADWORDS', 'bookHeadwords',
  'searchAllBooks', 'performLookup', 'openLookupFromContext', 'closeLookup', 'navigateToTab', 'switchBook',
  'bindStaticEvents', 'playAudio', 'playTTS', 'renderFlow', 'saveBookWithLookupIndex'];

function element() {
  const children = new Map();
  const classes = new Set();
  return { innerHTML: '', textContent: '', dataset: {}, isConnected: true, listeners: {}, attributes: {},
    classList: { add: value => classes.add(value), remove: value => classes.delete(value),
      contains: value => classes.has(value), toggle(value, enabled = !classes.has(value)) {
        if (enabled) classes.add(value); else classes.delete(value);
        return enabled;
      } },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus(options) { this.focused = options; }, close() {}, matches() { return false; },
    contains(node) { return [...children.values()].includes(node); },
    querySelector(key) { if (!children.has(key)) children.set(key, element()); return children.get(key); },
    querySelectorAll() { return []; } };
}

function app() {
  const elements = new Map();
  const document = { querySelector(key) { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); },
    querySelectorAll() { return []; }, body: element() };
  const timers = [];
  const audio = [];
  const reads = [];
  const window = { scrollX: 0, scrollY: 0, scrollTo({ left = 0, top = 0 }) { this.scrollX = left; this.scrollY = top; } };
  const context = vm.createContext({ document, window, console, Intl, Date, URL, Blob, structuredClone,
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); }, atob: value => Buffer.from(value, 'base64').toString(),
    Audio: class { constructor(src) { audio.push(this); this.src = src; this.paused = true; }
      play() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
      pause() { this.paused = true; } },
    fetch: async () => { throw new Error('offline'); }
  });
  vm.runInContext(source.replace('    init();', `    globalThis.api = { ${names.join(',')} };`), context);
  const api = context.api;
  const tables = Object.fromEntries(['books', 'sessions', 'progress', 'activity', 'meta', 'quizResults'].map(x => [x, new Map()]));
  let abortNext = false;
  api.state.db = { transaction(name) {
    const writes = [];
    let finished = false;
    let pending = 0;
    const finish = () => {
      if (finished || pending) return;
      finished = true;
      if (abortNext) {
        abortNext = false;
        tx.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        tx.onabort?.();
      } else {
        writes.forEach(fn => fn());
        tx.oncomplete?.();
      }
    };
    const tx = { abort() { finished = true; this.onabort?.(); }, objectStore(storeName = name) {
      const request = (value, write) => {
        const req = { result: structuredClone(value) };
        if (write) writes.push(write);
        pending++;
        queueMicrotask(() => {
          if (finished) return;
          req.onsuccess?.();
          pending--;
          if (!pending) queueMicrotask(finish);
        });
        return req;
      };
      return {
        get: key => { reads.push([storeName, 'get', key]); return request(tables[storeName].get(key)); },
        getAll: () => { reads.push([storeName, 'getAll']); return request([...tables[storeName].values()]); },
        getAllKeys: () => request([...tables[storeName].keys()]),
        put: value => { const copy = structuredClone(value); return request(value.id || value.key, () => tables[storeName].set(value.id || value.key, copy)); },
        delete: key => request(undefined, () => tables[storeName].delete(key))
      };
    } };
    return tx;
  } };
  api.state.book = { id: 'test', words: api.normalizeWords([{ id: 'a', word: 'alpha', meaning: '甲' }, { id: 'b', word: 'beta', meaning: '乙' }]) };
  api.state.settings = api.normalizeSettings({});
  return { ...api, context, window, elements, document, tables, timers, audio, reads, failNext() { abortNext = true; } };
}

if (process.argv.includes('--refresh-lookup-index')) {
  const a = app();
  const start = '    // BEGIN GENERATED LOOKUP HEADWORDS';
  const end = '    // END GENERATED LOOKUP HEADWORDS';
  const lines = [start, '    const BUNDLED_LOOKUP_HEADWORDS = {'];
  for (const book of a.BUNDLED_BOOKS) {
    const raw = JSON.parse(fs.readFileSync(path.join(root, book.url), 'utf8'));
    const words = a.bookHeadwords(raw.words);
    lines.push(`      ${JSON.stringify(book.id)}: [`);
    for (let index = 0; index < words.length; index += 10) {
      const row = words.slice(index, index + 10).map(word => JSON.stringify(word).replace(/</g, '\\u003c'));
      lines.push(`        ${row.join(', ')},`);
    }
    lines.push('      ],');
  }
  lines.push('    };', end);
  const indexStart = html.indexOf(start);
  const indexEnd = html.indexOf(end, indexStart);
  assert.ok(indexStart >= 0 && indexEnd > indexStart, 'Inline lookup index markers are missing');
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(appFile, html.slice(0, indexStart) + lines.join(eol) + html.slice(indexEnd + end.length));
  process.exit(0);
}

test('settings migrate missing and invalid values to bounded integer quotas', () => {
  const a = app();
  for (const value of [undefined, null, '', 'bad', NaN, Infinity, -2, 0]) assert.equal(a.normalizeSettings({ dailyNew: value }).dailyNew, 20);
  assert.equal(a.normalizeSettings({ dailyNew: '12.9' }).dailyNew, 12);
  assert.equal(a.normalizeSettings({ dailyNew: 800 }).dailyNew, 50);
  assert.equal(a.normalizeSettings({ dailyNew: 0.5 }).dailyNew, 1);
});

test('normalization repairs null children, preserves supplied IDs and avoids all collisions', () => {
  const a = app();
  const words = a.normalizeWords([{ id: 'foo', word: 'a', examples: [null, 'Example'], synonyms: [null], etymology: { cognates: [null] } },
    { id: 'foo-2', word: 'b' }, { id: 'foo', word: 'c' }, { id: 'space id', word: 'd' }, { id: 'foo-1', word: 'e' }]);
  assert.equal(new Set(words.map(w => w.id)).size, 5);
  assert.equal(words[1].id, 'foo-2'); assert.equal(words[3].id, 'space id'); assert.equal(words[4].id, 'foo-1');
  assert.equal(words[0].examples.length, 1); assert.equal(words[0].synonyms.length, 0);
  assert.equal(words[0].etymology.cognates.length, 0);
  assert.throws(() => a.normalizeWords([{ word: 42 }]));
});

test('all bundled books normalize without changing IDs; metadata counts agree with files', () => {
  const a = app();
  for (const book of a.BUNDLED_BOOKS) {
    const raw = JSON.parse(fs.readFileSync(path.join(root, book.url), 'utf8'));
    const normalized = a.withBundledMetadata(raw, book);
    assert.equal(normalized.wordCount, book.wordCount, book.id);
    assert.deepEqual(Array.from(normalized.words, w => w.id), raw.words.map(w => w.id));
    assert.deepEqual(Array.from(a.BUNDLED_LOOKUP_HEADWORDS[book.id]), Array.from(a.bookHeadwords(raw.words)), book.id);
  }
});

test('offline bundled and custom caches receive the same word validation', async () => {
  const a = app(), source = a.BUNDLED_BOOKS[0];
  a.tables.books.set(source.id, { id: source.id, version: source.version, words: [{ id: 'a', word: 'alpha' }] });
  a.tables.books.set('custom', { id: 'custom', words: [{ id: 'a', word: 'alpha' }] });
  for (const id of [source.id, 'custom']) {
    const book = await a.loadBookById(id);
    assert.equal(book.wordCount, 1); assert.equal(book.words[0].examples.length, 0);
  }
});

test('session repair restores queues and removes stale IDs without skipping the next valid word', () => {
  const a = app();
  const s = a.normalizeSession({ newIds: ['a', 'gone', 'b'], stage: 'learn', learnQueue: ['a', 'gone', 'b'], learnIndex: 2, repeats: null });
  assert.deepEqual(Array.from(s.learnQueue), ['a', 'b']); assert.equal(s.learnIndex, 1);
  assert.ok(s.removedIds.includes('gone')); assert.equal(s.reviewDone.length, 0);
  const legacy = a.normalizeSession({ newIds: ['a', 'b'], stage: 'quiz', quizIndex: 1 });
  assert.deepEqual(Array.from(legacy.quizQueue), ['a', 'b']); assert.equal(legacy.quizIndex, 1);
  const lostPlan = a.normalizeSession({ learnQueue: ['a', 'b'], quizQueue: ['a', 'b', 'a'], stage: 'quiz' });
  assert.deepEqual(Array.from(lostPlan.newIds), ['a', 'b']);
});

test('choice and spelling answers commit together with word statistics', async () => {
  const a = app();
  a.state.session = a.normalizeSession({ id: 'today', bookId: 'test', stage: 'quiz', newIds: ['a'], quizQueue: ['a'] });
  await a.answerQuiz('甲');
  assert.equal(a.tables.sessions.get('today').quizCorrect, 1);
  assert.equal(a.tables.progress.get('test:a').correct, 1);
  a.state.quizAnswered = false; a.state.session.quizMode = 'spelling';
  await a.answerSpelling('alpha');
  assert.equal(a.tables.sessions.get('today').quizCorrect, 2);
  assert.equal(a.tables.progress.get('test:a').correct, 2);
});

test('failed answer transaction rolls back both stores and permits a retry', async () => {
  const a = app();
  a.state.session = a.normalizeSession({ id: 'today', bookId: 'test', stage: 'quiz', newIds: ['a'], quizQueue: ['a'] });
  const originalTransaction = a.state.db.transaction;
  a.state.db.transaction = function (stores) {
    if (Array.isArray(stores)) a.failNext();
    return originalTransaction(stores);
  };
  await a.answerQuiz('甲');
  assert.equal(a.state.quizAnswered, false);
  assert.equal(a.state.session.quizAnswers.length, 0);
  assert.equal(a.tables.progress.size, 0); assert.equal(a.tables.sessions.size, 0);
  assert.match(a.document.querySelector('#toast').textContent, /存储空间不足/);
  a.state.db.transaction = originalTransaction;
  await a.answerQuiz('甲');
  assert.equal(a.tables.progress.get('test:a').correct, 1);
});

test('completed legacy sessions and completed activity are never reopened or downgraded', async () => {
  const a = app(), id = `test:${a.localDate()}`;
  a.tables.activity.set(id, { id, bookId: 'test', completed: true, completedAt: 123 });
  const s = await a.upgradeSession({ id, bookId: 'test', date: a.localDate(), completed: true, newIds: ['a'], completedAt: 123 });
  assert.equal(s.completed, true); assert.equal(s.stage, 'complete'); assert.equal(s.completedAt, 123);
  assert.equal(a.tables.activity.get(id).completed, true);
  await a.saveActivity(s, false);
  assert.equal(a.tables.activity.get(id).completed, true); assert.equal(a.tables.activity.get(id).completedAt, 123);
});

test('familiar words, skipped words and retries retain a stable plan and cannot show early completion', () => {
  const a = app();
  const s = a.state.session = a.normalizeSession({ newIds: ['a', 'b'], stage: 'learn' });
  assert.equal(a.sessionCounts().total, 6);
  s.newIds = ['b']; s.familiarIds = ['a']; s.learnDone = ['a', 'b'];
  assert.equal(a.sessionCounts().total, 6); assert.equal(a.sessionCounts().done, 4);
  s.quizAnswers = [{ wordId: 'b', type: 'choice' }, { wordId: 'b', type: 'choice' }];
  assert.equal(a.sessionCounts().done, 5);
  s.quizAnswers.push({ wordId: 'b', type: 'spelling' });
  assert.equal(a.sessionCounts().percent, 99);
  s.completed = true; assert.equal(a.sessionCounts().percent, 100);
});

test('empty or entirely removed active queues converge to completion', async () => {
  const a = app();
  a.state.session = a.normalizeSession({ id: 'today', bookId: 'test', date: a.localDate(), stage: 'quiz', newIds: ['gone'], quizQueue: ['gone'], quizMode: 'choice' });
  await a.advanceStage();
  assert.equal(a.state.session.completed, true);
  assert.equal(a.tables.sessions.get('today').stage, 'complete');
});

test('transaction success waits for commit and a post-request abort rejects', async () => {
  const a = app();
  a.failNext();
  await assert.rejects(a.dbRequest('meta', 'readwrite', store => store.put({ key: 'x' })), { name: 'QuotaExceededError' });
  assert.equal(a.tables.meta.has('x'), false);
  await a.dbRequest('meta', 'readwrite', store => store.put({ key: 'x' }));
  assert.equal(a.tables.meta.has('x'), true);
});

test('highlighting handles punctuation and Unicode while escaping every input segment', () => {
  const a = app();
  for (const word of ['e-mail', 'X-ray', 'C++', '中文', 'a/b', '<tag>']) assert.match(a.highlightWord(`Use ${word} today`, word), /<strong/);
  assert.doesNotMatch(a.highlightWord('concatenate cat-like', 'cat'), /<strong/);
  const safe = a.highlightWord('<img src=x onerror=alert(1)> & cat', 'cat');
  assert.doesNotMatch(safe, /<img/); assert.match(safe, /&lt;img/);
  assert.doesNotMatch(a.highlightWord('<', 'lt'), /<strong/);
});

test('analysis renders Markdown in learning and review details while escaping imported HTML', () => {
  const a = app();
  const word = a.normalizeWords([{ word: 'anticipate', meaning: '预期', analysis: `【AI讲解】
anticipate 常译为“预期、预料”。

### 常见句型怎么接

- anticipate something：预料某事
- anticipate doing something：预期会做某事

### 和 expect 的区别

**anticipate** 更强调提前准备，可用 *正式* 语气或 \`that\` 从句。

【动词用法】anticipate 是及物动词。` }])[0];
  for (const html of [a.wordDetailHTML(word), a.reviewDetailHTML(word)]) {
    assert.match(html, /<details class="info-section analysis-details" open><summary><strong class="analysis-label">【AI讲解】<\/strong><\/summary><div class="detail-body"><div class="analysis">/);
    assert.equal((html.match(/【AI讲解】/g) || []).length, 1);
    assert.doesNotMatch(html, /详细解析/);
    assert.match(html, /<h3>常见句型怎么接<\/h3>/);
    assert.match(html, /<ul><li>anticipate something：预料某事<\/li><li>anticipate doing something：预期会做某事<\/li><\/ul>/);
    assert.match(html, /<h3>和 expect 的区别<\/h3>/);
    assert.match(html, /<strong>anticipate<\/strong> 更强调提前准备，可用 <em>正式<\/em> 语气或 <code>that<\/code> 从句/);
    assert.match(html, /<strong class="analysis-label">【动词用法】<\/strong>/);
    assert.doesNotMatch(html, /### 常见句型|- anticipate something/);
  }
  assert.match(a.wordDetailHTML(word), /<\/div>\s*<details class="info-section analysis-details" open>/);
  assert.equal(a.analysisHTML(''), '');
  const safe = a.analysisHTML('普通说明\n\n1. 第一项\n2. 第二项\n\n<img src=x onerror=alert(1)> [资料](https://example.com) [危险](javascript:alert(1))');
  assert.match(safe, /<summary class="icon-only"><span class="sr-only">展开或收起单词解析<\/span><\/summary>/);
  assert.match(safe, /<ol><li>第一项<\/li><li>第二项<\/li><\/ol>/);
  assert.match(safe, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(safe, /<img|href="javascript:/);
  assert.match(safe, /href="https:\/\/example\.com"/);
  assert.match(a.analysisHTML('第一行\n第二行'), /<p>第一行<br>第二行<\/p>/);
  assert.match(a.analysisHTML('【旧格式】内容一\n【第二段】内容二'), /【第二段】<\/strong><p>内容二<\/p>/);
});

test('invalid standalone quizzes offer recovery without saving results or recursive skipping', () => {
  const a = app();
  a.state.tab = 'stats';
  a.state.statsQuiz = { bookId: 'test', questions: [{ wordId: 'gone', options: [] }], index: 0 };
  a.renderStatsQuiz();
  assert.match(a.document.querySelector('#studyView').innerHTML, /重新开始/);
  assert.equal(a.tables.quizResults.size, 0);
  a.answerStatsQuiz('x'); assert.equal(a.tables.quizResults.size, 0);
});

test('review renders no detail bodies or embedded search text until a card opens', async () => {
  const a = app();
  a.state.tab = 'review'; a.state.reviewFilter = 'unlearned';
  a.state.book.words[0].examples = [{ en: 'DEFERRED_EXAMPLE', zh: '' }];
  await a.renderReview();
  const markup = a.document.querySelector('#studyView').innerHTML;
  assert.doesNotMatch(markup, /DEFERRED_EXAMPLE|data-review-search/);
  assert.match(markup, /data-review-word="a"/);
  const detail = element();
  const card = { open: true, dataset: { reviewWord: 'a' }, matches: () => true, querySelector: () => detail };
  a.document.querySelector('#reviewList').listeners.toggle({ target: card });
  assert.match(detail.innerHTML, /DEFERRED_EXAMPLE/); assert.equal(card.dataset.loaded, 'true');
});

test('late review reads do not overwrite another page', async () => {
  const a = app();
  a.state.tab = 'review'; a.state.reviewFilter = 'unlearned';
  const pending = a.renderReview();
  a.state.tab = 'today'; a.document.querySelector('#studyView').innerHTML = 'TODAY';
  await pending;
  assert.equal(a.document.querySelector('#studyView').innerHTML, 'TODAY');
});

test('double click cancels pending audio; cancelled and stale failures stay silent', async () => {
  const a = app(), button = element();
  const first = a.playRemotePronunciation(a.state.book.words[0], 1, button);
  await a.playRemotePronunciation(a.state.book.words[0], 1, button);
  assert.equal(a.audio.length, 1); assert.equal(a.playRemotePronunciation.current, null);
  a.audio[0].reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
  await first;
  assert.equal(a.document.querySelector('#toast').textContent, '');
});

function bundledResponse(words) {
  return { ok: true, json: async () => ({ words }) };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function exerciseSpeech(a) {
  const spoken = [];
  const canceled = [];
  const remoteUS = { lang: 'en-US', localService: false };
  const localUK = { lang: 'en-GB', localService: true };
  a.window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  a.window.speechSynthesis = {
    getVoices: () => [remoteUS, localUK],
    speak: utterance => spoken.push(utterance),
    cancel: () => canceled.push(spoken.at(-1))
  };
  return { spoken, canceled, localUK };
}

test('cold misses never fetch wordbooks and exact cross-book hits fetch only the matching book', async () => {
  const a = app();
  const paths = [];
  a.context.fetch = async url => {
    paths.push(url);
    return bundledResponse([{ id: 'original-id', word: 'anticipate', meaning: '预期' }]);
  };
  assert.equal((await a.searchAllBooks(' ALPHA ')).bookId, 'test');
  const miss = await a.searchAllBooks('zz-no-such-word');
  assert.equal(miss.word, undefined);
  assert.deepEqual(Array.from(miss.unavailable), []);
  assert.deepEqual(paths, []);
  assert.equal(a.tables.books.size, 0);
  assert.equal(a.reads.some(([store]) => store === 'books'), false);

  const match = await a.searchAllBooks('anticipate');
  assert.equal(match.bookId, 'hight_school_2000');
  assert.equal(match.word.id, 'original-id');
  assert.deepEqual(paths, ['./hight_school_2000.json']);
  assert.equal(a.tables.books.size, 1);
  assert.deepEqual(a.tables.meta.get('lookup-headwords:hight_school_2000').headwords, ['anticipate']);

  a.reads.length = 0;
  await a.searchAllBooks('zz-no-such-word');
  assert.deepEqual(paths, ['./hight_school_2000.json']);
  assert.equal(a.reads.some(([store]) => store === 'books'), false);
});

test('legacy wordbooks get a small index once and keep offline terms and original IDs', async () => {
  const a = app();
  const old = { id: 'hight_school_2000', version: 'old', words: [{ id: 'keep-me', word: 'legacy-cache-only' }] };
  const custom = { id: 'imported', name: '旧导入词书', words: [{ id: 'custom-id', word: 'custom-cache-only' }] };
  a.tables.books.set(old.id, old);
  a.tables.books.set(custom.id, custom);
  a.tables.meta.set('custom-book-catalog', { key: 'custom-book-catalog', books: [{ id: custom.id, name: custom.name }] });
  a.context.fetch = () => assert.fail('a cached match should work without a download');

  assert.equal((await a.searchAllBooks('legacy-cache-only')).word.id, 'keep-me');
  assert.equal((await a.searchAllBooks('custom-cache-only')).word.id, 'custom-id');
  assert.deepEqual(a.tables.books.get(old.id), old);
  assert.deepEqual(a.tables.books.get(custom.id), custom);
  assert.deepEqual(a.tables.meta.get('lookup-headwords:imported').headwords, ['custom-cache-only']);

  a.reads.length = 0;
  assert.deepEqual(Array.from((await a.searchAllBooks('zz-no-such-word')).unavailable), []);
  assert.equal(a.reads.some(([store]) => store === 'books'), false);

  const updated = { ...custom, words: [{ id: 'custom-id', word: 'new-imported-term' }] };
  a.failNext();
  await assert.rejects(a.saveBookWithLookupIndex(updated), { name: 'QuotaExceededError' });
  assert.deepEqual(a.tables.books.get(custom.id), custom);
  assert.deepEqual(a.tables.meta.get('lookup-headwords:imported').headwords, ['custom-cache-only']);
  await a.saveBookWithLookupIndex(updated);
  assert.equal((await a.searchAllBooks('new-imported-term')).word.id, 'custom-id');
  assert.equal((await a.searchAllBooks('custom-cache-only')).word, undefined);
});

test('words added to the active bundled book are reported as unavailable when its old cache is offline', async () => {
  const a = app();
  a.context.console = { warn() {} };
  const book = { id: 'hight_school_2000', version: 'old', words: [{ id: 'legacy', word: 'legacy-cache-only' }] };
  a.tables.books.set(book.id, book);
  a.state.book = { ...book, words: a.normalizeWords(book.words) };

  assert.equal((await a.searchAllBooks('legacy-cache-only')).word.id, 'legacy');
  assert.deepEqual(Array.from((await a.searchAllBooks('anticipate')).unavailable), ['高中英语 2000']);
  a.context.fetch = async () => bundledResponse([{ id: 'current', word: 'anticipate' }]);
  assert.equal((await a.searchAllBooks('anticipate')).word.id, 'current');
  assert.equal(a.state.book.words[0].id, 'legacy');
});

test('lookup distinguishes unavailable details from a genuine miss and offers verified base forms', async () => {
  const a = app();
  const view = a.document.querySelector('#lookupView');
  a.context.console = { warn() {} };
  a.state.book.words = a.normalizeWords([
    { word: 'remain', meaning: '保持' }, { word: 'mouse', meaning: '老鼠' }, { word: 'studied', meaning: '专心的' }
  ]);

  const unavailable = await a.performLookup('anticipate');
  assert.deepEqual(Array.from(unavailable.unavailable), ['高中英语 2000']);
  assert.match(view.innerHTML, /查词结果不完整/);
  assert.doesNotMatch(view.innerHTML, /未找到「anticipate」/);

  await a.performLookup('zz-no-such-word');
  assert.match(view.innerHTML, /未找到「zz-no-such-word」/);
  const base = await a.performLookup('remained');
  assert.equal(base.word.word, 'remain');
  assert.equal(base.baseForm, 'remain');
  assert.match(view.innerHTML, /已按原形显示「remained」/);
  assert.equal((await a.performLookup('mice')).word.word, 'mouse');
  assert.equal((await a.performLookup('studied')).baseForm, undefined);

  a.failNext();
  await a.performLookup('zz-no-such-word');
  assert.match(view.innerHTML, /暂时无法查询/);
});

test('only the latest lookup updates the UI, and close or tab navigation discards pending results', async () => {
  const a = app();
  a.state.session = a.normalizeSession({ id: 'today', newIds: ['a'] });
  const pendingRequest = deferred();
  const requested = deferred();
  a.context.fetch = url => { requested.resolve(url); return pendingRequest.promise; };

  const first = a.performLookup('anticipate');
  assert.equal(await requested.promise, './hight_school_2000.json');
  await a.performLookup('alpha');
  pendingRequest.resolve(bundledResponse([{ word: 'anticipate' }]));
  await first;
  assert.equal(a.state.lookupWord.word.word, 'alpha');

  const closeRequest = deferred();
  const closeRequested = deferred();
  a.context.fetch = () => { closeRequested.resolve(); return closeRequest.promise; };
  const pendingClose = a.performLookup('zucchini');
  await closeRequested.promise;
  a.closeLookup();
  closeRequest.resolve(bundledResponse([{ word: 'zucchini' }]));
  await pendingClose;
  assert.equal(a.state.lookupWord, null);
  assert.equal(a.document.querySelector('#lookupView').hidden, true);

  const navRequest = deferred();
  const navRequested = deferred();
  a.context.fetch = () => { navRequested.resolve(); return navRequest.promise; };
  const pendingNav = a.performLookup('resilient');
  await navRequested.promise;
  await a.navigateToTab('plan');
  navRequest.resolve(bundledResponse([{ word: 'resilient' }]));
  await pendingNav;
  assert.equal(a.state.lookupWord, null);
  assert.match(a.document.querySelector('#studyView').innerHTML, /学习计划/);
});

test('lookup returns to the same open review view and restores the original focus after nested searches', async () => {
  const a = app();
  a.state.tab = 'review';
  a.state.reviewFilter = 'unlearned';
  a.state.reviewQuery = 'alpha';
  await a.renderReview();
  const study = a.document.querySelector('#studyView');
  const view = a.document.querySelector('#lookupView');
  const oldMarkup = study.innerHTML;
  const opener = element();
  const nested = element();
  a.window.scrollTo({ left: 4, top: 260 });

  await a.openLookupFromContext('alpha', opener);
  assert.equal(study.hidden, true);
  assert.equal(view.hidden, false);
  assert.match(view.innerHTML, /返回回顾/);
  assert.equal(a.window.scrollY, 0);

  await a.openLookupFromContext('beta', nested);
  assert.equal(a.state.lookupWord.word.word, 'beta');
  a.closeLookup();
  assert.equal(a.state.lookupWord, null);
  assert.equal(a.state.lookupReturnContext, null);
  assert.equal(a.state.reviewFilter, 'unlearned');
  assert.equal(a.state.reviewQuery, 'alpha');
  assert.equal(study.innerHTML, oldMarkup);
  assert.equal(study.hidden, false);
  assert.equal(view.hidden, true);
  assert.equal(opener.focused.preventScroll, true);
  assert.equal(nested.focused, undefined);
  assert.equal(a.window.scrollX, 4);
  assert.equal(a.window.scrollY, 260);
});

test('changing the active wordbook exits lookup and invalidates an in-flight search', async () => {
  const a = app();
  a.state.session = a.normalizeSession({ id: 'today', newIds: ['a'] });
  const target = { id: 'imported', name: '新词书', words: [{ id: 'c', word: 'charlie' }] };
  await a.saveBookWithLookupIndex(target);
  a.state.books = [target];
  await a.performLookup('alpha');

  const response = deferred();
  const requested = deferred();
  a.context.fetch = () => { requested.resolve(); return response.promise; };
  const pending = a.performLookup('anticipate');
  await requested.promise;
  await a.switchBook(target.id);
  response.resolve(bundledResponse([{ word: 'anticipate' }]));
  await pending;
  assert.equal(a.state.book.id, target.id);
  assert.equal(a.state.settings.activeBookId, target.id);
  assert.equal(a.state.lookupWord, null);
  assert.equal(a.state.lookupReturnContext, null);
  assert.match(a.document.querySelector('#studyView').innerHTML, /今日学习/);
});

test('lookup accent playback uses the result word even when the active book shares its ID', async () => {
  const a = app();
  const foreign = { id: 'imported', name: '另一词书', words: [{ id: 'a', word: 'foreign', phonetic: '/f/' }] };
  await a.saveBookWithLookupIndex(foreign);
  a.bindStaticEvents();
  await a.performLookup('foreign');
  const button = a.document.querySelector('#lookupView').querySelector('[data-pronunciation-type]');
  button.dataset.pronunciationWord = 'a';
  button.dataset.pronunciationType = '2';
  button.closest = selector => selector === '[data-pronunciation-type]' ? button : null;
  const playing = a.document.querySelector('#main').listeners.click({ target: button, preventDefault() {}, stopPropagation() {} });
  assert.equal(a.audio.length, 1);
  assert.match(a.audio[0].src, /audio=foreign&type=2$/);
  a.audio[0].resolve();
  await playing;
  a.closeLookup();
  assert.equal(a.playRemotePronunciation.current, null);
});

test('quick lookup is rendered as native buttons and keeps the headword highlighted and escaped', () => {
  const a = app();
  const word = a.normalizeWords([{ word: 'e-mail', examples: [{ en: 'Use e-mail & <example>.' }],
    phrases: [{ en: 'send e-mail' }], synonyms: ['e-mail', 'be', 'contact'], etymology: { cognates: ['mailing'] } }])[0];
  for (const markup of [a.wordDetailHTML(word, true), a.reviewDetailHTML(word, true)]) {
    assert.match(markup, /<strong style="color:var\(--indigo\)">e-mail<\/strong>/);
    for (const term of ['Use', 'contact', 'mailing']) {
      assert.match(markup, new RegExp('<button class="lookup-word" type="button" data-lookup-word="' + term + '">'));
    }
    assert.doesNotMatch(markup, /data-lookup-word="(?:e-mail|be)"|<example>/);
    assert.match(markup, /data-tts-text="Use e-mail &amp; &lt;example&gt;\."/);
  }
});

test('TTS selects a local voice, stops on a second click and ignores stale completion or interruption', () => {
  const a = app();
  const { spoken, canceled, localUK } = exerciseSpeech(a);
  const first = element(), second = element();
  a.playTTS('First example', first);
  a.playTTS('Second example', second);
  assert.equal(spoken[0].voice, localUK);
  assert.equal(spoken[0].rate, 0.9);
  assert.deepEqual(canceled, [spoken[0]]);
  assert.equal(first.attributes['aria-pressed'], 'false');
  assert.equal(second.attributes['aria-pressed'], 'true');

  spoken[0].onend();
  spoken[0].onerror({ error: 'interrupted' });
  assert.equal(a.state.ttsPlayback.utterance, spoken[1]);
  assert.equal(a.document.querySelector('#toast').textContent, '');
  a.playTTS('Second example', second);
  assert.deepEqual(canceled, spoken);
  assert.equal(a.state.ttsPlayback, null);
  assert.equal(second.attributes['aria-pressed'], 'false');

  a.playTTS('Network voice', first);
  spoken[2].onerror({ error: 'network' });
  assert.equal(a.state.ttsPlayback, null);
  assert.match(a.document.querySelector('#toast').textContent, /网络/);
});

test('TTS is canceled on lookup departure, navigation and a new study card', async () => {
  const a = app();
  const { spoken, canceled } = exerciseSpeech(a);
  const button = element();
  a.state.session = a.normalizeSession({ id: 'today', stage: 'learn', newIds: ['a', 'b'] });
  a.state.flowOpen = true;
  a.renderFlow();

  a.playTTS('Source phrase', button);
  await a.performLookup('beta');
  a.playTTS('Lookup phrase', button);
  a.closeLookup();
  assert.equal(a.state.flowOpen, true);
  assert.match(a.document.querySelector('#studyView').innerHTML, /alpha/);

  a.playTTS('Study phrase', button);
  a.state.session.learnIndex = 1;
  a.renderFlow();
  assert.match(a.document.querySelector('#studyView').innerHTML, /beta/);
  a.playTTS('Next phrase', button);
  await a.navigateToTab('plan');
  assert.deepEqual(canceled, spoken);
  assert.equal(a.state.ttsPlayback, null);
  assert.equal(button.attributes['aria-pressed'], 'false');
});

test('stale recorded audio failures cannot interrupt a newer sentence reading', async () => {
  const a = app();
  const { spoken } = exerciseSpeech(a);
  const wordButton = element(), sentenceButton = element();
  const pending = a.playAudio({ word: 'alpha', audioBase64: 'bad-recording' }, wordButton);
  assert.equal(wordButton.attributes['aria-pressed'], 'true');
  a.playTTS('A sentence', sentenceButton);
  assert.equal(wordButton.attributes['aria-pressed'], 'false');
  a.audio[0].reject(new Error('stale play error'));
  await pending;
  assert.equal(spoken.length, 1);
  assert.equal(a.state.ttsPlayback.utterance.text, 'A sentence');
  assert.equal(sentenceButton.attributes['aria-pressed'], 'true');
});
