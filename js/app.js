import * as srs from './srs.js';
import * as store from './store.js';
import * as audio from './audio.js';

// 画面の不具合がキャッシュ由来かを切り分けるための版番号。コードを変えたら上げる
const APP_VERSION = 'phase2-lang-r1';

// 「必要なし」の確定待ち。350ms はタップ貫通の防止、5秒で自動的に元へ戻す
const SKIP_ARM_MS = 350;
const SKIP_REVERT_MS = 5000;

const $ = (id) => document.getElementById(id);

const state = {
  today: null,
  phrases: [],
  byId: {},
  langs: {},        // data/phrases.json の langs ブロック
  scenes: {},
  primary: null,    // 採点される言語
  refLangs: [],     // 参考として並べる言語（主言語以外の ready な言語）
  cards: {},        // 現在の主言語ぶんだけ。全言語マップは持たない
  meta: null,
  trip: null,       // { departure, sweepOrder? } または null（未設定を許す）
  queue: [],        // [{id, kind: 'review'|'new'}]
  index: 0,
  revealed: false,
  slow: false,
  session: null,
  isReplay: false,
  pendingSkip: null,  // { armTimer, revertTimer }
  saveFailed: false,
};

// ---- 基準日 ----

function resolveToday() {
  const q = new URLSearchParams(location.search).get('today');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  return srs.isoFromDate(new Date());
}

// ---- 言語 ----

/** 採点対象になりうる言語（gradable かつ ready） */
function gradableLangs() {
  return Object.keys(state.langs).filter(
    (l) => state.langs[l].gradable && state.langs[l].status === 'ready'
  );
}

/** 画面に出す言語（ready なものだけ）。主言語以外が参考行になる */
function readyLangs() {
  return Object.keys(state.langs).filter((l) => state.langs[l].status === 'ready');
}

function labelOf(lang) {
  return (state.langs[lang] || {}).label || lang;
}

function shortOf(lang) {
  return (state.langs[lang] || {}).labelShort || lang.toUpperCase();
}

/** 本文。未収録でも落ちないように空文字を返す */
function textOf(phrase, lang) {
  const sub = (phrase.langs || {})[lang];
  return sub && typeof sub.text === 'string' ? sub.text : '';
}

function kanaOf(phrase, lang) {
  const sub = (phrase.langs || {})[lang];
  return sub && typeof sub.kana === 'string' ? sub.kana : '';
}

function noteOf(phrase, lang) {
  const sub = (phrase.langs || {})[lang];
  return sub && typeof sub.note === 'string' ? sub.note : '';
}

/** その言語の推奨ロケール。要素の lang 属性に使う */
function localeOf(lang) {
  const sp = (state.langs[lang] || {}).speech || {};
  return (Array.isArray(sp.prefer) && sp.prefer[0]) || lang;
}

function recomputeRefLangs() {
  state.refLangs = readyLangs().filter((l) => l !== state.primary);
}

// ---- 画面切替 ----

function show(name) {
  ['setup', 'home', 'session', 'done', 'settings'].forEach((s) => {
    $(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
}

// ---- 言語スイッチャーの描画 ----

function renderLangSwitch(containerId, selected, onPick) {
  const box = $(containerId);
  box.replaceChildren();
  for (const lang of gradableLangs()) {
    const label = document.createElement('label');
    label.className = 'lang-opt';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = containerId;
    input.value = lang;
    input.checked = lang === selected;
    const span = document.createElement('span');
    span.textContent = labelOf(lang);
    label.append(input, span);
    input.addEventListener('change', () => onPick(lang));
    box.append(label);
  }
}

// ---- 初回セットアップ ----

/**
 * 出発日を保存する。妥当でなければエラー文を返し、成功なら null を返す。
 * 出発日をソースに持たないため、この入力が唯一の設定経路になる。
 */
function applyDeparture(lang, value) {
  if (!srs.isValidTrip({ departure: value })) return `${labelOf(lang)}の出発日を選んでください`;
  if (srs.diffDays(state.today, value) <= 0) {
    return `${labelOf(lang)}の出発日は明日以降にしてください`;
  }
  store.saveTrip(lang, { departure: value });
  if (lang === state.primary) state.trip = store.loadTrip(lang);
  return null;
}

function showSetup() {
  renderLangSwitch('setup-lang-switch', state.primary, (lang) => {
    state.primary = lang;
    audio.setPrimary(lang);
    recomputeRefLangs();
  });
  $('input-departure').value = '';
  $('setup-error').classList.add('hidden');
  show('setup');
}

// ---- ホーム ----

function renderHome() {
  $('lang-name').textContent = labelOf(state.primary);
  $('streak').textContent = state.meta.streak || 0;

  const stats = srs.retentionStats(state.cards, state.phrases);
  $('retained').textContent = stats.retained;
  $('total').textContent = stats.total;
  // 除外で total が 0 になりうるのでゼロ除算を防ぐ
  $('progress').style.width = `${stats.total ? (stats.retained / stats.total) * 100 : 0}%`;
  $('retained-wrap').setAttribute(
    'aria-label',
    `定着 ${stats.retained} / 対象 ${stats.total}。除外${stats.suspended}件を除く`
  );

  // 除外件数（主言語ぶん）
  $('excluded-count').textContent = stats.suspended;
  $('btn-excluded').classList.toggle('hidden', stats.suspended === 0);

  // 出発日が未設定の言語。セットアップ画面へ飛ばさず、ここから設定に誘導する
  if (!state.trip) {
    $('days-left').textContent = '—';
    $('departure-note').textContent = 'この言語の出発日が未設定です';
    $('btn-start').textContent = '出発日を設定する';
    $('btn-start').disabled = false;
    $('home-today').textContent = '';
    renderAudioWarning();
    return;
  }

  const left = srs.daysUntilDeparture(state.today, state.trip);
  const mode = srs.modeFor(state.today, state.trip);

  $('days-left').textContent = left > 0 ? left : 0;
  $('departure-note').textContent = `出発 ${state.trip.departure}`;

  // ボタンは常に1つ。その日の必須分が残っていればそれを、終わっていれば再挑戦を出す。
  // 「完了」で操作を打ち切らない。区切りを宣言させないため。
  const doneToday = state.meta.lastDone === state.today;
  const s = buildSession();
  const pending = s.reviewIds.length + s.newIds.length;
  const replayCount =
    mode === 'trip' ? 0 : srs.buildReplay(state.today, state.cards, state.phrases).length;

  $('btn-start').disabled = false;

  if (mode === 'trip') {
    $('departure-note').textContent = '旅行中';
    $('days-left').textContent = '0';
    $('btn-start').textContent = '旅行モードは次のフェーズで実装';
    $('btn-start').disabled = true;
    $('home-today').textContent = '';
  } else if (pending > 0) {
    $('btn-start').textContent = '今日の10分をはじめる';
    const parts = [];
    if (s.reviewIds.length) parts.push(`復習 ${s.reviewIds.length}`);
    if (s.newIds.length) parts.push(`新規 ${s.newIds.length}`);
    const modeLabel = mode === 'sweep' ? '最終スイープ' : null;
    $('home-today').textContent = [modeLabel, parts.join(' / ')].filter(Boolean).join('・');
  } else if (replayCount > 0) {
    $('btn-start').textContent = `もう一度やる（${replayCount}枚）`;
    $('home-today').textContent = doneToday
      ? '今日の分は完了。何回でも復習できる'
      : '今日の新規は出しきった。復習は何回でもできる';
  } else {
    $('btn-start').textContent = '今日の出題はなし';
    $('btn-start').disabled = true;
    $('home-today').textContent = '';
  }

  renderAudioWarning();
}

function renderAudioWarning() {
  const warn = audio.warningText();
  $('audio-warning').textContent = warn || '';
  $('audio-warning').classList.toggle('hidden', !warn);

  $('save-warning').textContent = state.saveFailed
    ? '保存できていません。設定からJSONを書き出してください。'
    : '';
  $('save-warning').classList.toggle('hidden', !state.saveFailed);
}

// ---- スイープ順の凍結 ----

/**
 * スイープ突入時に並びを凍結し、抜けたら捨てる。
 * 1回目の割り当ては配列インデックスで決まるので、期間中にフレーズが増減すると
 * 全カードのスロットがずれて出題されないカードが出る。それを構造的に防ぐ。
 */
function syncSweepOrder() {
  if (!state.trip) return;
  const mode = srs.modeFor(state.today, state.trip);
  if (mode === 'sweep') {
    if (!state.trip.sweepOrder) {
      const ids = state.phrases.map((p) => p.id);
      store.saveSweepOrder(state.primary, ids);
      state.trip = store.loadTrip(state.primary);
    }
  } else if (state.trip.sweepOrder) {
    store.clearSweepOrder(state.primary);
    state.trip = store.loadTrip(state.primary);
  }
}

function buildSession() {
  if (!state.trip) return { mode: 'study', reviewIds: [], newIds: [], overflow: 0 };
  return srs.buildSession(state.today, state.cards, state.phrases, state.trip, {
    sweepOrder: state.trip.sweepOrder,
  });
}

// ---- 保存 ----

function persist(card) {
  const ok = store.saveCard(state.primary, card);
  if (!ok) state.saveFailed = true;
  return ok;
}

// ---- セッション ----

function startSession() {
  const s = buildSession();
  state.session = s;
  state.isReplay = false;
  state.queue = [
    ...s.reviewIds.map((id) => ({ id, kind: 'review' })),
    ...s.newIds.map((id) => ({ id, kind: 'new' })),
  ];
  state.index = 0;

  if (state.queue.length === 0) return;
  show('session');
  renderCard();
}

/** その日の分をもう一度。新規は投入せず、今日さわったカードだけを出す */
function startReplay() {
  const ids = srs.buildReplay(state.today, state.cards, state.phrases);
  if (ids.length === 0) return;

  state.session = { reviewIds: ids, newIds: [], overflow: 0 };
  state.isReplay = true;
  state.queue = ids.map((id) => ({ id, kind: 'review' }));
  state.index = 0;

  show('session');
  renderCard();
}

function currentItem() {
  return state.queue[state.index];
}

function renderRefRow(p, lang) {
  const li = document.createElement('li');
  li.className = 'ref-row';

  const btn = document.createElement('button');
  btn.className = 'ref-play';
  btn.dataset.lang = lang;
  btn.setAttribute('aria-label', `${labelOf(lang)}を再生`);
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▶';
  const code = document.createElement('span');
  code.textContent = shortOf(lang);
  btn.append(icon, code);

  const text = textOf(p, lang);
  if (!text || !audio.isAvailable(lang)) btn.disabled = true;

  const body = document.createElement('div');
  body.className = 'ref-body';
  const t = document.createElement('p');
  t.className = 'ref-text';
  t.lang = localeOf(lang);
  t.textContent = text || '（未収録）';
  body.append(t);

  const kana = kanaOf(p, lang);
  if (kana) {
    const k = document.createElement('p');
    k.className = 'ref-kana';
    k.lang = 'ja';
    k.textContent = kana;
    body.append(k);
  }

  li.append(btn, body);
  return li;
}

function renderCard() {
  const item = currentItem();
  const p = state.byId[item.id];

  state.revealed = item.kind === 'new';
  state.slow = false;
  $('btn-slow').textContent = 'ゆっくり';
  clearSkipConfirm();

  // 「だめ」で末尾に再出題されるとキューが伸びるため、分母は常に現在のキュー長を使う
  const total = state.queue.length;
  $('session-progress').style.width = `${(state.index / total) * 100}%`;
  const stage = item.kind === 'new' ? '新規' : state.isReplay ? '再挑戦' : '復習';
  $('session-stage').textContent = `${stage} ${state.index + 1}/${total}`;

  $('card-scene').textContent = state.scenes[p.scene] || p.scene;
  $('card-jp').textContent = p.jp;

  // 主言語
  $('primary-chip').textContent = shortOf(state.primary);
  const pt = $('primary-text');
  pt.textContent = textOf(p, state.primary) || '（未収録）';
  pt.lang = localeOf(state.primary);
  $('primary-kana').textContent = kanaOf(p, state.primary);
  $('primary-note').textContent = noteOf(p, state.primary);

  // 参考言語
  const list = $('ref-list');
  list.replaceChildren(...state.refLangs.map((l) => renderRefRow(p, l)));

  // 他言語のメモは1つの details にまとめる。3つ並べると文字の壁になる
  const notes = state.refLangs
    .map((l) => [l, noteOf(p, l)])
    .filter(([, n]) => n);
  const body = $('ref-notes-body');
  body.replaceChildren();
  for (const [l, n] of notes) {
    const dt = document.createElement('dt');
    dt.textContent = labelOf(l);
    const dd = document.createElement('dd');
    dd.textContent = n;
    body.append(dt, dd);
  }
  $('ref-notes').classList.toggle('hidden', notes.length === 0);

  $('card-back').classList.toggle('hidden', !state.revealed);
  $('btn-reveal').classList.toggle('hidden', state.revealed);
  $('grade-row').classList.toggle('hidden', item.kind === 'new' || !state.revealed);
  $('btn-next').classList.toggle('hidden', item.kind !== 'new');
  $('skip-row').classList.toggle('hidden', !state.revealed);

  if (state.revealed) audio.speak(p, state.primary, 1.0);
  markCardLength();
}

/** 長いカードは中央寄せをやめる。flexbox が先頭を切り落とすのを避ける */
function markCardLength() {
  const card = $('card');
  card.classList.remove('is-long');
  if (card.scrollHeight > card.clientHeight) card.classList.add('is-long');
}

function reveal() {
  if (state.revealed) return;
  state.revealed = true;
  $('card-back').classList.remove('hidden');
  $('btn-reveal').classList.add('hidden');
  $('grade-row').classList.remove('hidden');
  $('skip-row').classList.remove('hidden');
  audio.speak(state.byId[currentItem().id], state.primary, 1.0);
  markCardLength();
}

function grade(g) {
  const item = currentItem();
  if (item.kind !== 'review' || !state.revealed) return;

  const card = state.cards[item.id];
  state.cards[item.id] = srs.nextState(card, g, state.today);
  persist(state.cards[item.id]);

  // だめ だったカードは当日セッションの末尾に再出題する
  if (g === 'again') {
    state.queue.push({ id: item.id, kind: 'review' });
  }
  advance();
}

function nextNew() {
  const item = currentItem();
  if (item.kind !== 'new') return;
  state.cards[item.id] = srs.introduce(item.id, state.today);
  persist(state.cards[item.id]);
  advance();
}

// ---- 必要なし ----

function clearSkipConfirm() {
  if (state.pendingSkip) {
    clearTimeout(state.pendingSkip.armTimer);
    clearTimeout(state.pendingSkip.revertTimer);
    state.pendingSkip = null;
  }
  $('btn-skip').classList.remove('hidden');
  const box = $('skip-confirm');
  box.classList.add('hidden');
  box.classList.remove('is-arming');
}

function armSkip() {
  if (!state.revealed || state.pendingSkip) return;
  $('btn-skip').classList.add('hidden');
  const box = $('skip-confirm');
  box.classList.remove('hidden');
  // 同じ場所への2度目のタップが「除外する」に着弾するのを防ぐ
  box.classList.add('is-arming');
  state.pendingSkip = {
    armTimer: setTimeout(() => box.classList.remove('is-arming'), SKIP_ARM_MS),
    revertTimer: setTimeout(clearSkipConfirm, SKIP_REVERT_MS),
  };
}

function confirmSkip() {
  const item = currentItem();
  if (!item || !state.revealed) return;

  if (item.kind === 'new') {
    // 投入を経由するので当日の新規枠を1つ消費する
    state.cards[item.id] = srs.suspendNew(item.id, state.today);
  } else {
    // 採点ではないので nextState は呼ばない
    state.cards[item.id] = srs.suspend(state.cards[item.id], state.today);
    // 「だめ」で末尾に積まれた同じidの重複を、現在位置より後ろから取り除く。
    // これをしないと除外したはずのカードが同じセッションの後半で再浮上する
    state.queue = state.queue.filter((q, i) => i <= state.index || q.id !== item.id);
  }
  persist(state.cards[item.id]);
  clearSkipConfirm();
  advance();
}

function advance() {
  audio.stop();
  clearSkipConfirm();
  state.index += 1;
  if (state.index >= state.queue.length) {
    finishSession();
    return;
  }
  renderCard();
}

function finishSession() {
  // 1枚も出題していないセッションでストリークを加算しない
  if (state.queue.length > 0) {
    state.meta = store.recordSession(state.meta, state.today, srs.addDays(state.today, -1));
  }
  const meta = state.meta;

  $('done-streak').textContent = meta.streak || 0;

  const s = state.session || { reviewIds: [], newIds: [], overflow: 0 };
  const parts = [];
  if (s.reviewIds.length) {
    parts.push(`${state.isReplay ? '再挑戦' : '復習'} ${s.reviewIds.length}枚`);
  }
  if (s.newIds.length) parts.push(`新規 ${s.newIds.length}枚`);
  $('done-summary').textContent = parts.length ? parts.join(' / ') : '今日の出題はありませんでした';

  // 今日1回でも間違えたカードは、あとで正解しても明日また出る
  const carry = Object.values(state.cards).filter(
    (c) => !c.suspended && c.gradedOn === state.today && c.dayWorst === 'again'
  ).length;
  $('done-carry').classList.toggle('hidden', carry === 0);
  if (carry > 0) {
    $('done-carry').textContent = `間違えた ${carry}枚は明日また出ます`;
  }

  // 150枚を1日30枚で回す以上、詰まる日は出る。失敗ではないので中立に伝える
  const hasOverflow = (s.overflow || 0) > 0;
  $('done-overflow').classList.toggle('hidden', !hasOverflow);
  if (hasOverflow) {
    $('done-overflow').textContent = `残り ${s.overflow}枚は明日にまわしました`;
  }

  const skipped = Object.values(state.cards).filter((c) => c.suspendedOn === state.today).length;
  $('done-skipped').classList.toggle('hidden', skipped === 0);
  if (skipped > 0) {
    $('done-skipped').textContent = `今日「必要なし」にした ${skipped}枚は設定の除外リストから戻せます`;
  }

  show('done');
}

// ---- 主言語の切り替え ----

function setPrimaryLanguage(lang) {
  if (lang === state.primary) return;

  audio.stop();            // 必ず最初。旧言語の発話が画面切替後も鳴り続けるのを防ぐ
  audio.setPrimary(lang);
  clearSkipConfirm();

  state.primary = lang;
  store.setPrimary(lang);
  recomputeRefLangs();

  // 言語ごとに分かれている状態を読み直す
  state.cards = store.loadProgress(lang);
  const t = store.loadTrip(lang);
  state.trip = srs.isValidTrip(t) ? t : null;   // null は正常。未設定を許す

  // セッション状態は全消し
  state.queue = [];
  state.index = 0;
  state.revealed = false;
  state.slow = false;
  state.session = null;
  state.isReplay = false;

  // state.today / phrases / byId / meta は不変（デッキとストリークは全言語共通）
  syncSweepOrder();

  const note = $('lang-switch-note');
  if (!state.trip) {
    note.textContent = `${labelOf(lang)}の出発日がまだ設定されていません`;
    renderSettings();
    const input = $(`dep-${lang}`);
    if (input) {
      input.focus();
      input.scrollIntoView({ block: 'center' });
    }
    return;
  }

  note.textContent = `${labelOf(lang)}に切り替えました`;
  renderSettings();
  setTimeout(() => {
    if ($('lang-switch-note').textContent === `${labelOf(lang)}に切り替えました`) {
      renderSettings();
    }
  }, 4000);
}

// ---- 設定 ----

const DEFAULT_NOTE =
  '採点されるのはここで選んだ言語だけ。残りの言語は答えの下に参考として並ぶ。' +
  '進捗・出発日・除外リストは言語ごとに分かれて保存され、切り替えても消えない。';

function renderDepGrid() {
  const grid = $('dep-grid');
  grid.replaceChildren();
  const trips = store.loadTrips();
  for (const lang of gradableLangs()) {
    const label = document.createElement('label');
    label.className = 'dep-row';
    if (lang === state.primary) label.classList.add('is-active');
    const name = document.createElement('span');
    name.className = 'dep-lang';
    name.textContent = labelOf(lang);
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'date-input';
    input.id = `dep-${lang}`;
    input.setAttribute('aria-label', `${labelOf(lang)}の出発日`);
    input.value = (trips[lang] && trips[lang].departure) || '';
    label.append(name, input);
    grid.append(label);
  }
}

/** 除外リストを描画する。既定は主言語ぶん、チェックで全言語に広げる */
function renderExclusionList() {
  const showAll = $('excl-all-langs').checked;
  const langsToShow = showAll ? readyLangs() : [state.primary];
  const rows = [];
  for (const lang of langsToShow) {
    const cards = lang === state.primary ? state.cards : store.loadProgress(lang);
    for (const c of Object.values(cards)) {
      if (!c.suspended) continue;
      const p = state.byId[c.id];
      if (!p) continue;   // 孤立カードは除外リストにも出さない
      rows.push({ lang, card: c, phrase: p });
    }
  }
  rows.sort((a, b) => (b.card.suspendedOn || '').localeCompare(a.card.suspendedOn || ''));

  const list = $('excl-list');
  list.replaceChildren();
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'excl-item';

    const main = document.createElement('div');
    main.className = 'excl-main';
    const jp = document.createElement('p');
    jp.className = 'excl-jp';
    jp.lang = 'ja';
    jp.textContent = r.phrase.jp;
    const target = document.createElement('p');
    target.className = 'excl-target';
    const tag = document.createElement('span');
    tag.className = 'excl-lang';
    tag.textContent = shortOf(r.lang);
    const txt = document.createElement('span');
    txt.lang = localeOf(r.lang);
    txt.textContent = textOf(r.phrase, r.lang);
    target.append(tag, txt);
    const date = document.createElement('p');
    date.className = 'excl-date';
    date.textContent = r.card.suspendedOn ? `${r.card.suspendedOn} に除外` : '';
    main.append(jp, target, date);

    const btn = document.createElement('button');
    btn.className = 'excl-restore';
    btn.textContent = '戻す';
    btn.setAttribute('aria-label', `${r.phrase.jp} を戻す`);
    btn.addEventListener('click', () => restoreOne(r.lang, r.card.id));

    li.append(main, btn);
    list.append(li);
  }

  $('excl-summary').textContent = showAll
    ? `全言語 ${rows.length}件`
    : `${labelOf(state.primary)} ${rows.length}件`;
  $('excl-empty').classList.toggle('hidden', rows.length > 0);
  $('excl-count').textContent = rows.length;
  $('btn-excl-restore-all').classList.toggle('hidden', rows.length === 0);
  return rows;
}

function restoreOne(lang, id) {
  const cards = lang === state.primary ? state.cards : store.loadProgress(lang);
  const c = cards[id];
  if (!c) return;
  const back = srs.unsuspend(c, state.today);
  if (lang === state.primary) state.cards[id] = back;
  if (!store.saveCard(lang, back)) state.saveFailed = true;
  renderSettings();
}

function restoreAllShown() {
  const rows = renderExclusionList();
  if (rows.length === 0) return;
  if (!confirm(`除外を${rows.length}件戻します。次回のセッションから出題されます。`)) return;
  for (const r of rows) {
    const back = srs.unsuspend(r.card, state.today);
    if (r.lang === state.primary) state.cards[r.card.id] = back;
    if (!store.saveCard(r.lang, back)) state.saveFailed = true;
  }
  renderSettings();
}

function renderSettings() {
  renderLangSwitch('lang-switch', state.primary, setPrimaryLanguage);
  renderDepGrid();

  // 音声（主言語のみ）
  $('voice-lang-name').textContent = labelOf(state.primary);
  const st = audio.status(state.primary);
  const statusText = {
    ready: `${labelOf(state.primary)}の音声を使用中`,
    fallback: '推奨ロケールの音声なし。別の地域の音声で代用中',
    none: `${labelOf(state.primary)}の音声が見つかりません`,
    unsupported: 'この端末は音声合成に未対応',
    unknown: '判定中',
  }[st.voiceStatus];
  $('voice-status').textContent =
    `${statusText}${st.voiceName ? `: ${st.voiceName} / ${st.voiceLocale}` : ''} / MP3 ${st.mp3Count}件`;
  const voices = audio.listVoices(state.primary);
  $('voice-list').textContent = voices.length
    ? `端末の音声: ${voices.join(' , ')}`
    : '端末の音声: なし';

  // 進捗
  const stats = srs.retentionStats(state.cards, state.phrases);
  const cards = Object.values(state.cards).filter((c) => !c.suspended);
  const boxes = [1, 2, 3, 4, 5].map(
    (b) => `箱${b}:${cards.filter((c) => (c.box || 1) === b).length}`
  );
  $('progress-detail').textContent =
    `投入 ${stats.introduced}/${stats.total} / ${boxes.join(' ')} / 除外 ${stats.suspended} / ` +
    `連続 ${state.meta.streak || 0}日 / セッション ${state.meta.totalSessions || 0}回`;
  $('progress-all').textContent = readyLangs()
    .filter((l) => state.langs[l].gradable)
    .map((l) => {
      const c = l === state.primary ? state.cards : store.loadProgress(l);
      const s2 = srs.retentionStats(c, state.phrases);
      return `${shortOf(l)} 定着${s2.retained}/${s2.total}`;
    })
    .join(' ・ ');

  // 孤立カード。自動削除はしない（誤って消したフレーズを戻したら進捗も戻る必要がある）
  const orphans = srs.orphanIds(state.cards, state.phrases);
  $('orphan-note').classList.toggle('hidden', orphans.length === 0);
  $('btn-orphan-purge').classList.toggle('hidden', orphans.length === 0);
  if (orphans.length) {
    $('orphan-note').textContent =
      `孤立した進捗 ${orphans.length}件（消えたフレーズの記録）: ${orphans.join(', ')}`;
  }

  renderExclusionList();
  $('btn-legacy-import').classList.toggle('hidden', !store.legacyPresent());
  $('reset-lang-name').textContent = labelOf(state.primary);

  $('app-version').textContent = APP_VERSION;
  $('today-value').textContent = state.today;
  $('mode-value').textContent = state.trip
    ? { study: '学習', sweep: '最終スイープ', trip: '旅行' }[srs.modeFor(state.today, state.trip)]
    : '出発日未設定';
}

function openSettings(scrollToExclusions = false) {
  renderSettings();
  show('settings');
  if (scrollToExclusions) $('excl-list').scrollIntoView({ block: 'start' });
}

// ---- 配線 ----

function wire() {
  $('btn-setup-save').addEventListener('click', () => {
    const err = applyDeparture(state.primary, $('input-departure').value);
    if (err) {
      $('setup-error').textContent = err;
      $('setup-error').classList.remove('hidden');
      return;
    }
    store.setPrimary(state.primary);
    state.cards = store.loadProgress(state.primary);
    syncSweepOrder();
    renderHome();
    show('home');
  });

  $('btn-departure-save').addEventListener('click', () => {
    let firstError = null;
    for (const lang of gradableLangs()) {
      const value = $(`dep-${lang}`).value;
      if (!value) continue;                     // 空欄は「未設定」で合法
      const err = applyDeparture(lang, value);
      if (err && !firstError) firstError = err;
    }
    $('departure-error').textContent = firstError || '';
    $('departure-error').classList.toggle('hidden', !firstError);
    $('btn-departure-save').textContent = firstError ? '出発日を保存' : '保存しました';
    state.trip = store.loadTrip(state.primary);
    syncSweepOrder();
    renderSettings();
  });

  // 必須分が残っていれば通常セッション、終わっていれば再挑戦へ
  $('btn-start').addEventListener('click', () => {
    if (!state.trip) { openSettings(); return; }
    const s = buildSession();
    if (s.reviewIds.length + s.newIds.length > 0) startSession();
    else startReplay();
  });

  $('btn-reveal').addEventListener('click', reveal);
  $('btn-next').addEventListener('click', nextNew);

  document.querySelectorAll('.grade').forEach((b) => {
    b.addEventListener('click', () => grade(b.dataset.grade));
  });

  $('btn-skip').addEventListener('click', (e) => { e.stopPropagation(); armSkip(); });
  $('btn-skip-cancel').addEventListener('click', (e) => { e.stopPropagation(); clearSkipConfirm(); });
  $('btn-skip-yes').addEventListener('click', (e) => { e.stopPropagation(); confirmSkip(); });

  $('btn-replay').addEventListener('click', (e) => {
    e.stopPropagation();
    audio.speak(state.byId[currentItem().id], state.primary, state.slow ? 0.75 : 1.0);
  });

  $('btn-slow').addEventListener('click', (e) => {
    e.stopPropagation();
    state.slow = !state.slow;
    $('btn-slow').textContent = state.slow ? '標準の速さ' : 'ゆっくり';
    audio.speak(state.byId[currentItem().id], state.primary, state.slow ? 0.75 : 1.0);
  });

  // 参考言語の再生ボタンは動的に作られるので委譲で拾う
  $('ref-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.ref-play');
    if (!btn || btn.disabled) return;
    e.stopPropagation();
    audio.speak(state.byId[currentItem().id], btn.dataset.lang, 1.0);
  });

  $('btn-quit').addEventListener('click', () => {
    audio.stop();
    clearSkipConfirm();
    renderHome();
    show('home');
  });

  $('btn-home').addEventListener('click', () => {
    renderHome();
    show('home');
  });

  $('btn-copy').addEventListener('click', async () => {
    const line = `- [x] [[${labelOf(state.primary)}]] ✅ ${state.today}`;
    try {
      await navigator.clipboard.writeText(line);
      $('btn-copy').textContent = 'コピーしました';
    } catch (e) {
      $('btn-copy').textContent = line;
    }
  });

  $('btn-settings').addEventListener('click', () => openSettings());
  $('btn-lang').addEventListener('click', () => openSettings());
  $('btn-excluded').addEventListener('click', () => openSettings(true));

  $('btn-settings-close').addEventListener('click', () => {
    $('lang-switch-note').textContent = DEFAULT_NOTE;
    renderHome();
    show('home');
  });

  $('excl-all-langs').addEventListener('change', renderExclusionList);
  $('btn-excl-restore-all').addEventListener('click', restoreAllShown);

  $('btn-orphan-purge').addEventListener('click', () => {
    const orphans = srs.orphanIds(state.cards, state.phrases);
    if (orphans.length === 0) return;
    if (!confirm(`消えたフレーズの進捗 ${orphans.length}件を消します。元に戻せません。`)) return;
    orphans.forEach((id) => delete state.cards[id]);
    if (!store.saveProgress(state.primary, state.cards)) state.saveFailed = true;
    renderSettings();
  });

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `polyglot-trainer-${state.today}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('input-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = store.importJSON(await file.text());
      reloadFromStore();
      renderSettings();
      alert(`読み込みました（version ${r.version} / ${r.langs.join(', ')}）`);
    } catch (err) {
      alert(`読み込みに失敗: ${err.message}`);
    }
    e.target.value = '';
  });

  $('btn-legacy-import').addEventListener('click', () => {
    if (!confirm('旧データでポルトガル語の進捗を置き換えます。元に戻せません。')) return;
    const r = store.migrateLegacy({ force: true });
    reloadFromStore();
    renderSettings();
    alert(r.migrated ? `${r.count}枚を取り込みました` : `取り込めませんでした（${r.reason}）`);
  });

  $('btn-reset-lang').addEventListener('click', () => {
    if (!confirm(`${labelOf(state.primary)}の進捗をすべて消します。元に戻せません。`)) return;
    store.resetProgress(state.primary);
    state.cards = {};
    renderSettings();
  });

  $('btn-reset-all').addEventListener('click', () => {
    if (!confirm('すべての言語の進捗を消します。元に戻せません。')) return;
    store.resetAll();
    reloadFromStore();
    renderSettings();
  });

  // Macでのキーボード操作。数字が採点、アルファベットが音声
  document.addEventListener('keydown', (e) => {
    if ($('screen-session').classList.contains('hidden')) return;
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;

    const item = currentItem();
    if (!item) return;
    const k = e.key.toLowerCase();

    if (k === 'escape') {
      if (state.pendingSkip) { e.preventDefault(); clearSkipConfirm(); }
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      // 確定待ちを飛ばして進んでしまわないよう、キー入力をここで消費する
      if (state.pendingSkip) { clearSkipConfirm(); return; }
      if (item.kind === 'new') nextNew();
      else if (!state.revealed) reveal();
      return;
    }

    if (!state.revealed) return;

    if (k === '4') {
      e.preventDefault();
      if (state.pendingSkip) confirmSkip();
      else armSkip();
      return;
    }

    if (k === '0') {
      e.preventDefault();
      state.slow = !state.slow;
      $('btn-slow').textContent = state.slow ? '標準の速さ' : 'ゆっくり';
      audio.speak(state.byId[item.id], state.primary, state.slow ? 0.75 : 1.0);
      return;
    }

    // 言語キー。主言語なら「ゆっくり」設定に従い、参考言語は常に 1.0
    const byKey = { p: 'pt', s: 'es', i: 'it', e: 'en' };
    if (byKey[k] && state.langs[byKey[k]]) {
      const lang = byKey[k];
      const rate = lang === state.primary && state.slow ? 0.75 : 1.0;
      audio.speak(state.byId[item.id], lang, rate);
      return;
    }

    if (item.kind === 'review') {
      if (k === '1') grade('again');
      if (k === '2') grade('vague');
      if (k === '3') grade('good');
    }
  });
}

// ---- 起動 ----

function reloadFromStore() {
  const settings = store.loadSettings();
  const fallback = gradableLangs().find((l) => state.langs[l].default) || gradableLangs()[0];
  // 手編集や将来のビルドが書いた値で描画中に落ちないよう、必ず検証してから採用する
  const valid = settings.primary && gradableLangs().includes(settings.primary);
  state.primary = valid ? settings.primary : fallback;
  if (!valid) store.setPrimary(state.primary);

  recomputeRefLangs();
  state.cards = store.loadProgress(state.primary);
  state.meta = store.loadMeta();
  const t = store.loadTrip(state.primary);
  state.trip = srs.isValidTrip(t) ? t : null;
}

async function main() {
  state.today = resolveToday();

  // どの loadProgress よりも前。同期で、例外を投げない
  store.migrateLegacy();

  const res = await fetch('data/phrases.json', { cache: 'no-cache' });
  const data = await res.json();
  if (data.version !== 2) {
    throw new Error(`data/phrases.json の version が 2 ではありません: ${data.version}`);
  }
  state.phrases = data.phrases;
  state.byId = Object.fromEntries(state.phrases.map((p) => [p.id, p]));
  state.langs = data.langs || {};
  state.scenes = data.scenes || {};

  reloadFromStore();
  wire();

  // 真の初回（どの言語にも妥当な旅程が無い）だけセットアップを出す。
  // それ以外は、主言語に出発日が無くてもホームから設定へ誘導する
  const trips = store.loadTrips();
  const anyTrip = Object.values(trips).some((t) => srs.isValidTrip(t));
  if (!anyTrip) {
    showSetup();
    await audio.init(state.langs, state.primary);
    return;
  }

  syncSweepOrder();
  renderHome();
  show('home');

  await audio.init(state.langs, state.primary);
  renderHome(); // 音声の判定結果を反映
}

main().catch((e) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'padding:20px;white-space:pre-wrap';
  pre.textContent =
    `起動に失敗しました\n\n${e.message}\n\n` +
    'file:// で開いていませんか。python3 tools/serve.py で配信してください。';
  document.body.replaceChildren(pre);
});
