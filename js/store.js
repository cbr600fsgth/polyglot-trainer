// localStorage の読み書き。iOSのPWAは長期未使用でストレージが破棄されうるため
// エクスポート/インポートを必ず用意する。
//
// キー名は poly.* を使う。GitHub Pages では ユーザー名.github.io が
// リポジトリをまたいで同一オリジンになるため、旧アプリ（pt.*）と衝突させないための改名。
// 旧キーからの移行は migrateLegacy() が起動時に一度だけ行い、旧キーは消さない。
//
// このモジュールは LEGACY_LANG 以外の言語コードを一切知らない。言語カタログは
// data/phrases.json にあり、store.js はそれを読まない。4言語目を足す作業が
// データ編集だけで済むのはこの性質のおかげなので、ここに言語の一覧を足さないこと。
//
// 詳細は docs/SPEC-multilingual.md の 4章。

const K = {
  progress: 'poly.progress',   // { [lang]: { [id]: card } }
  trips: 'poly.trips',         // { [lang]: { departure, sweepOrder? } }
  meta: 'poly.meta',           // 言語横断で1つ
  settings: 'poly.settings',   // { primary, showLangs }
};

// 旧アプリのキー。移行元としてのみ参照し、削除はしない
const LEGACY = { cards: 'pt.cards', meta: 'pt.meta', trip: 'pt.trip' };
const LEGACY_LANG = 'pt';

export const KEYS = K;
export const LEGACY_KEYS = LEGACY;

// modeOverride は宣言だけで読まれていなかったため v2 で廃止した
const DEFAULT_META = {
  streak: 0,
  lastDone: null,      // 最後にセッションを完了した日 'YYYY-MM-DD'
  totalSessions: 0,
};

const META_FIELDS = ['streak', 'lastDone', 'totalSessions', 'migratedFrom', 'migratedAt'];
const SETTINGS_FIELDS = ['primary', 'showLangs'];
const TRIP_FIELDS = ['departure', 'sweepOrder'];

/** 既知のキーだけを取り出す。手編集や古い書き出しファイルからの混入を防ぐ */
function pick(obj, fields) {
  return Object.fromEntries(
    fields.filter((f) => obj[f] !== undefined).map((f) => [f, obj[f]])
  );
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`${key} の読み込みに失敗。初期値を使う`, e);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`${key} の保存に失敗`, e);
    return false;
  }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ---- 進捗 ----

export function loadAllProgress() {
  const all = read(K.progress, {});
  return isPlainObject(all) ? all : {};
}

export function loadProgress(lang) {
  const slice = loadAllProgress()[lang];
  return isPlainObject(slice) ? slice : {};
}

/**
 * その言語の進捗を丸ごと置き換える。他言語は必ず読み直してから書き戻す。
 * 「全言語まとめて保存する関数」は意図的に用意していない。呼び出し側が古い
 * 全言語マップを持ち回って書き戻すのが、他言語の進捗を消す唯一の経路だからである。
 */
export function saveProgress(lang, cards) {
  const all = loadAllProgress();
  all[lang] = cards;
  return write(K.progress, all);
}

/** 採点1枚ぶんの高速経路。全件の stringify をホットパスから外す */
export function saveCard(lang, card) {
  const all = loadAllProgress();
  if (!isPlainObject(all[lang])) all[lang] = {};
  all[lang][card.id] = card;
  return write(K.progress, all);
}

/** 進捗が1枚以上ある言語の一覧。設定画面の表示用 */
export function languagesWithProgress() {
  const all = loadAllProgress();
  return Object.keys(all).filter(
    (l) => isPlainObject(all[l]) && Object.keys(all[l]).length > 0
  );
}

// ---- 旅程（言語ごと） ----

export function loadTrips() {
  const t = read(K.trips, {});
  return isPlainObject(t) ? t : {};
}

/** { departure, sweepOrder? } または未設定なら null */
export function loadTrip(lang) {
  const t = loadTrips()[lang];
  return isPlainObject(t) ? t : null;
}

/** 出発日を保存する。trip に含まれていなければ既存の sweepOrder を保つ */
export function saveTrip(lang, trip) {
  const all = loadTrips();
  const prev = isPlainObject(all[lang]) ? all[lang] : {};
  const next = pick(trip || {}, TRIP_FIELDS);
  if (next.sweepOrder === undefined && prev.sweepOrder !== undefined) {
    next.sweepOrder = prev.sweepOrder;
  }
  all[lang] = next;
  return write(K.trips, all);
}

export function loadSweepOrder(lang) {
  const t = loadTrip(lang);
  return t && Array.isArray(t.sweepOrder) ? t.sweepOrder : null;
}

export function saveSweepOrder(lang, ids) {
  const all = loadTrips();
  if (!isPlainObject(all[lang])) return false;   // 出発日が無い言語には持たせない
  all[lang] = { ...all[lang], sweepOrder: ids };
  return write(K.trips, all);
}

export function clearSweepOrder(lang) {
  const all = loadTrips();
  if (!isPlainObject(all[lang])) return false;
  const { sweepOrder, ...rest } = all[lang];
  all[lang] = rest;
  return write(K.trips, all);
}

// ---- メタ（言語横断） ----

export function loadMeta() {
  const m = read(K.meta, {});
  return { ...DEFAULT_META, ...(isPlainObject(m) ? m : {}) };
}

export function saveMeta(meta) {
  return write(K.meta, pick(meta, META_FIELDS));
}

/**
 * セッション完了を記録し、更新後のmetaを返す。同じ日に2回完了してもストリークは増えない。
 * ストリークは言語をまたいで1本。主言語を切り替えても連続日数はリセットしない。
 */
export function recordSession(meta, today, yesterday) {
  if (meta.lastDone === today) return meta;

  const next = {
    ...meta,
    lastDone: today,
    totalSessions: (meta.totalSessions || 0) + 1,
    streak: meta.lastDone === yesterday ? (meta.streak || 0) + 1 : 1,
  };
  saveMeta(next);
  return next;
}

// ---- 設定 ----

/** { primary, showLangs }。未設定なら両方 null（データ側の既定に従う） */
export function loadSettings() {
  const s = read(K.settings, {});
  const base = { primary: null, showLangs: null };
  return { ...base, ...pick(isPlainObject(s) ? s : {}, SETTINGS_FIELDS) };
}

export function saveSettings(s) {
  return write(K.settings, pick(s, SETTINGS_FIELDS));
}

export function setPrimary(lang) {
  return saveSettings({ ...loadSettings(), primary: lang });
}

// ---- エクスポート / インポート ----

export function exportJSON() {
  return JSON.stringify(
    {
      kind: 'polyglot-trainer-progress',
      version: 3,
      exportedAt: new Date().toISOString(),
      settings: loadSettings(),
      progress: loadAllProgress(),
      trips: loadTrips(),
      meta: loadMeta(),
    },
    null,
    2
  );
}

/**
 * 進捗を読み込む。version 3（多言語）と version 2（旧アプリ）の両方を受け付ける。
 *
 * 共通の規則: ファイルに入っている言語スロットだけを置き換え、入っていない言語には触らない。
 * 旧形式は es/it について何の情報も持たないので、消すより残すほうが常に正しい。
 *
 * 検証をすべて済ませてから書き込む。壊れた多言語ファイルで一部だけ書き込まれるのが
 * ここで起こりうる最悪の結果だからである。
 */
export function importJSON(text) {
  const data = JSON.parse(text);
  if (!isPlainObject(data)) throw new Error('JSONの形式が違います');

  let slices;
  let trips;
  if (isPlainObject(data.progress)) {
    slices = data.progress;                                       // version 3
    trips = isPlainObject(data.trips) ? data.trips : {};
  } else if (isPlainObject(data.cards)) {
    slices = { [LEGACY_LANG]: data.cards };                       // version 2（旧形式）
    trips = isPlainObject(data.trip) ? { [LEGACY_LANG]: data.trip } : {};
  } else {
    throw new Error('progress も cards も見つかりません。このアプリの書き出しファイルではありません');
  }

  for (const [lang, cards] of Object.entries(slices)) {
    if (!isPlainObject(cards)) throw new Error(`${lang} の進捗の形式が違います`);
  }

  const all = loadAllProgress();
  for (const [lang, cards] of Object.entries(slices)) all[lang] = cards;
  if (!write(K.progress, all)) {
    throw new Error('保存に失敗しました。端末の空き容量を確認してください');
  }

  const t = loadTrips();
  for (const [lang, trip] of Object.entries(trips)) {
    if (isPlainObject(trip) && typeof trip.departure === 'string') {
      t[lang] = pick(trip, TRIP_FIELDS);
    }
  }
  write(K.trips, t);

  if (isPlainObject(data.meta)) saveMeta({ ...DEFAULT_META, ...data.meta });
  if (isPlainObject(data.settings)) saveSettings(data.settings);

  return {
    version: data.version || 2,
    langs: Object.keys(slices),
    counts: Object.fromEntries(
      Object.entries(slices).map(([l, c]) => [l, Object.keys(c).length])
    ),
  };
}

// ---- 旧データからの移行 ----

/** 旧アプリのカードが残っているか。設定画面の「旧データから取り込み直す」の出し分け用 */
export function legacyPresent() {
  return localStorage.getItem(LEGACY.cards) !== null;
}

/**
 * pt.cards / pt.meta / pt.trip → poly.* への一度きりの移行。
 * 旧キーは消さない（移行の失敗や、古いキャッシュのapp.jsからの復旧のため）。
 *
 * 冪等性の判定は poly.progress キーの「生の存在」で行う。JSON.parse を通した後だと
 * 空オブジェクトとキー未存在を区別できない。別途フラグを持つ案は、フラグと実データが
 * 食い違いうるので採らない。
 *
 * @param {{force?: boolean}} opts force なら pt スロットを旧データで置き換える
 */
export function migrateLegacy({ force = false } = {}) {
  const already = localStorage.getItem(K.progress) !== null;
  if (already && !force) return { migrated: false, reason: 'already' };

  const rawCards = localStorage.getItem(LEGACY.cards);

  // 完全な新規利用者。空の器を1度だけ書き、以後この関数は 'already' で即座に戻る
  if (rawCards === null) {
    if (!already) write(K.progress, {});
    return { migrated: false, reason: already ? 'nothing-to-migrate' : 'fresh' };
  }

  let cards = null;
  try {
    cards = JSON.parse(rawCards);
  } catch (e) {
    console.warn('旧データ pt.cards を読めない', e);
  }
  if (!isPlainObject(cards)) {
    if (!already) write(K.progress, {});   // 器は作る。旧キーは残るので手で復旧できる
    return { migrated: false, reason: 'legacy-unreadable' };
  }

  // 1) 進捗。カードは一切加工しない（suspended の補填もしない）
  const all = already ? loadAllProgress() : {};
  all[LEGACY_LANG] = cards;
  if (!write(K.progress, all)) return { migrated: false, reason: 'write-failed' };

  // 2) 出発日。既に poly 側にあれば上書きしない
  const trip = read(LEGACY.trip, null);
  if (isPlainObject(trip) && typeof trip.departure === 'string') {
    const trips = loadTrips();
    if (!isPlainObject(trips[LEGACY_LANG])) {
      trips[LEGACY_LANG] = { departure: trip.departure };
      write(K.trips, trips);
    }
  }

  // 3) メタ。ストリークは言語横断で1本なのでそのまま引き継ぐ
  const lm = read(LEGACY.meta, null);
  if (isPlainObject(lm) && localStorage.getItem(K.meta) === null) {
    write(
      K.meta,
      pick(
        { ...DEFAULT_META, ...lm, migratedFrom: 'pt.*', migratedAt: new Date().toISOString() },
        META_FIELDS
      )
    );
  }

  // 4) 設定。旧データは必ず pt なので主言語は pt から始める
  if (localStorage.getItem(K.settings) === null) {
    write(K.settings, { primary: LEGACY_LANG, showLangs: null });
  }

  // 5) 旧キーは削除しない
  return { migrated: true, reason: 'ok', count: Object.keys(cards).length };
}

// ---- 消去 ----

/** その言語の進捗と凍結したスイープ順だけを消す。出発日とストリークは残す */
export function resetProgress(lang) {
  const all = loadAllProgress();
  delete all[lang];
  const ok = write(K.progress, all);
  clearSweepOrder(lang);
  return ok;
}

export function resetMeta() {
  localStorage.removeItem(K.meta);
}

/** poly.* を全消し。pt.* には触らない（旧アプリの進捗を巻き込まないため） */
export function resetAll() {
  localStorage.removeItem(K.progress);
  localStorage.removeItem(K.trips);
  localStorage.removeItem(K.meta);
  localStorage.removeItem(K.settings);
}
