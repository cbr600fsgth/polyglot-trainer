// 期限逆算SRS。2段構成。
//   第1段 学習期（開始〜スイープ開始前日）: 箱方式（間隔 1/2/4/8/14日）
//   第2段 最終スイープ（出発の10日前〜出発前日）: 箱を止め、全カードを残り日数へ均等割り当て
//
// 「出発時点で最後に見たのが3週間前のカード」を防ぐ役割は第2段が担う。
// 当初は第1段でも残日数に応じて最大間隔を圧縮していたが、150枚では逆効果だったため外した。
// 出発直前に間隔を詰めると需要が1日50枚に達し、上限30枚では吸収できず未消化が積み上がる。
// しかも枠を食うのは箱4-5の定着済みカードで、弱いカードが押し出されていた。
// 圧縮を外すと未消化は48枚→8枚、定着は99→108（8シード平均）に改善した。
//
// 出発日はソースに持たない。利用者が初回に入力し、端末のlocalStorageにだけ保存する。
// 各関数は trip = { departure: 'YYYY-MM-DD' } を引数で受け取る。
// 学習開始日は不要（スケジュールは出発日までの残日数だけで決まる）。
//
// 日付はすべて 'YYYY-MM-DD' の文字列で扱う。純関数のみ。

export const NEW_PER_DAY = 5;   // 学習期の1日あたり新規投入数
export const REVIEW_CAP = 30;   // 学習期の1セッション復習上限。超過は翌日へ繰り越す
export const SWEEP_CAP = 25;    // スイープ期の1日あたり出題上限
export const SWEEP_DAYS = 10;   // 最終スイープの日数。出発日の何日前から始めるか

// 箱1..5の間隔（日）
export const BOX_INTERVALS = [1, 2, 4, 8, 14];

// ---- 日付ユーティリティ（UTC日番号ベース。DSTの影響を受けない） ----

function pad(n) {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' → 1970-01-01からの日数 */
export function dayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** 日数 → 'YYYY-MM-DD' */
export function fromDayNum(n) {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(iso, n) {
  return fromDayNum(dayNum(iso) + n);
}

/** to - from を日数で返す */
export function diffDays(from, to) {
  return dayNum(to) - dayNum(from);
}

/** Dateオブジェクト → 'YYYY-MM-DD'（ローカル暦日） */
export function isoFromDate(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// ---- 旅程 ----

/** 出発日の入力が妥当か */
export function isValidTrip(trip) {
  return !!trip && typeof trip.departure === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(trip.departure);
}

/** 最終スイープの開始日。出発日から逆算するので設定項目にしない */
export function sweepStart(trip) {
  return addDays(trip.departure, -SWEEP_DAYS);
}

// ---- モード判定 ----

/** 'study' | 'sweep' | 'trip' */
export function modeFor(today, trip) {
  if (diffDays(today, trip.departure) <= 0) return 'trip';
  if (diffDays(sweepStart(trip), today) >= 0) return 'sweep';
  return 'study';
}

export function daysUntilDeparture(today, trip) {
  return diffDays(today, trip.departure);
}

// ---- 第1段: 学習期の期限計算 ----

const SEVERITY = { again: 0, vague: 1, good: 2 };

/** 2つの採点のうち悪い方を返す */
function worseOf(a, b) {
  if (a === undefined) return b;
  return SEVERITY[a] <= SEVERITY[b] ? a : b;
}

/**
 * 採点結果から次のカード状態を返す。
 * grade: 'again'（だめ） | 'vague'（あいまい） | 'good'（できた）
 *
 * 同じ日に何度でも再挑戦できる。その日の予定は「その日に付いた最悪の採点」で決まるため、
 * 1回でも間違えたカードは、あとで正解しても翌日にまた出てくる。
 * 再計算は当日最初の採点時点の箱（preBox）を基準に行うので、繰り返しても状態が累積しない。
 */
export function nextState(card, grade, today) {
  const sameDay = card.gradedOn === today;
  const baseBox = sameDay ? card.preBox || 1 : card.box || 1;
  const worst = sameDay ? worseOf(card.dayWorst, grade) : grade;

  // 投入日は昇格させない。新規カードは必ず翌日に復習する
  const canPromote = card.firstSeen !== today;

  let box = baseBox;
  if (worst === 'again') {
    box = 1;
  } else if (worst === 'good' && canPromote) {
    box = Math.min(baseBox + 1, BOX_INTERVALS.length);
  }
  // 'vague' は箱を動かさない

  // lapses は「間違えた日数」を数える。同じ日に何度間違えても1回だけ
  let lapses = card.lapses || 0;
  const alreadyLapsedToday = sameDay && card.dayWorst === 'again';
  if (worst === 'again' && !alreadyLapsedToday) lapses += 1;

  const interval = BOX_INTERVALS[box - 1];

  return {
    ...card,
    box,
    lapses,
    due: addDays(today, interval),
    lastSeen: today,
    gradedOn: today,
    dayWorst: worst,
    preBox: baseBox,
  };
}

/** 定着済みとみなす基準。箱4以上（間隔8日以上に到達） */
export function isRetained(card) {
  return !card.suspended && (card.box || 1) >= 4;
}

// ---- 「必要なし」（除外）と孤立カード ----
//
// 除外は進捗カード側のフラグで表す。キーが無い状態が「有効」を意味するので、
// 有効に戻すときは delete する。false は書かない。移行前の既存カードに何も足さずに
// 済み、素朴な if (c.suspended) が古いデータに対しても正しく動く。
//
// 「必要なし」は採点ではない。SEVERITY に足さず、nextState() には渡さない。

export function isSuspended(card) {
  return !!(card && card.suspended);
}

/** 「必要なし」。主言語のカードだけを止める。箱もlapsesも消さない */
export function suspend(card, today) {
  const next = { ...card, suspended: true, suspendedOn: today };
  delete next.unsuspendedOn;
  return next;
}

/**
 * 未投入のフレーズを、投入と同時に「必要なし」にする。
 * 投入を経由するので、その日の新規枠を1つ消費する。日次上限はセッション時間を
 * 抑えるためにあり、利用者は実際にそのカードに時間を使っているので、これが正しい。
 * 「必要なし」を連打してデッキを掘り進める抜け道も同時に塞がる。
 */
export function suspendNew(id, today) {
  return suspend(introduce(id, today), today);
}

/**
 * 除外を解除する。
 *  - 一度でも採点したカード: 箱・lapses をそのまま復帰させ、当日から復習に出す
 *  - 一度も採点していないカード: 新規として投入し直す（当日の新規枠を1つ使う）
 *
 * 未採点カードを投入し直すのは、firstSeen が復活日になることで当日の昇格を
 * 禁止できるからである。まとめて復活させるとその日の新規枠が尽きるが、
 * これは翌日のキューが溢れるのを防ぐ自己抑制として意図している。
 */
export function unsuspend(card, today) {
  const fresh = !card.gradedOn;
  const base = fresh ? introduce(card.id, today) : { ...card, due: today };
  const next = { ...base, unsuspendedOn: today };
  delete next.suspended;
  delete next.suspendedOn;
  return next;
}

/**
 * 出題対象になるカードだけを返す。次の2種類を落とす。
 *   - suspended: 「必要なし」で止めたカード
 *   - orphan:    phrases.json から消えたフレーズのカード（記録は残すが出題しない）
 *
 * srs.js が allPhrases から読むのは id だけ。言語という概念は持たない。
 */
export function activeCards(cards, allPhrases) {
  const live = new Set(allPhrases.map((p) => p.id));
  const out = {};
  for (const id of Object.keys(cards)) {
    const c = cards[id];
    if (!live.has(id)) continue;
    if (c.suspended) continue;
    out[id] = c;
  }
  return out;
}

/** phrases.json から消えたフレーズのカードのID。設定画面の掃除用 */
export function orphanIds(cards, allPhrases) {
  const live = new Set(allPhrases.map((p) => p.id));
  return Object.keys(cards).filter((id) => !live.has(id));
}

/**
 * ホームの「定着 N / M」。除外は分母からも分子からも外れる。
 * total が 0 になりうるので、割り算する側でゼロ除算を防ぐこと。
 */
export function retentionStats(cards, allPhrases) {
  let retained = 0;
  let introduced = 0;
  let suspended = 0;
  allPhrases.forEach((p) => {
    const c = cards[p.id];
    if (!c) return;
    if (c.suspended) { suspended += 1; return; }
    introduced += 1;
    if (isRetained(c)) retained += 1;
  });
  return { retained, total: allPhrases.length - suspended, introduced, suspended };
}

// ---- 第2段: 最終スイープの均等割り当て ----

/**
 * スイープ用の並び。凍結済みの並びがあれば既存要素の位置を1つも動かさず、
 * 未知のIDだけを末尾に足す。消えたIDも位置を保つために残す（カードが無いので出題されない）。
 *
 * 1回目の割り当ては配列インデックス（i % n）で決まるため、スイープ期間中に
 * phrases.json の途中へ挿入・削除すると以降の全カードのスロットがずれ、
 * スロット n-1 のカードがスロット0へ折り返して二度と出題されなくなる。
 * 凍結配列を絶対にフィルタせず末尾にだけ足すことで、インデックス安定性を構成上保証する。
 */
export function resolveSweepOrder(frozen, allPhrases) {
  const ids = allPhrases.map((p) => p.id);
  if (!Array.isArray(frozen) || frozen.length === 0) return ids;
  const known = new Set(frozen);
  return frozen.concat(ids.filter((id) => !known.has(id)));
}

/** スイープ開始日から出発前日までの日付配列。SWEEP_DAYS 日ぶん */
export function sweepDays(trip) {
  const days = [];
  for (let i = 0; ; i++) {
    const day = addDays(sweepStart(trip), i);
    if (diffDays(day, trip.departure) <= 0) break;
    days.push(day);
  }
  return days;
}

/** lapses に応じた出題回数 */
function repsFor(card) {
  const l = card.lapses || 0;
  if (l >= 4) return 3;
  if (l >= 2) return 2;
  return 1;
}

/**
 * 全カードをスイープ期間へ均等割り当てし、日付→カードID配列 のマップを返す。
 *
 * 基準となる1回目の割り当ては「カリキュラム順のインデックス」だけで決める。
 * これは不変値なので、スイープ中に lapses が増えて再計算されても割り当てが動かず、
 * 全カードが必ず1回は出題されることが保証される。
 * 弱点カードの2回目・3回目は基準日から半周・1/3周ずらした日に足す（同日重複しない）。
 *
 * @param {string[]} orderedIds phrases.json の順序に並んだID
 * @param {Object} cards { [id]: card } 投入済みのカード
 * @param {Object} trip { departure: 'YYYY-MM-DD' }
 */
export function sweepPlan(orderedIds, cards, trip) {
  const days = sweepDays(trip);
  const n = days.length;
  const buckets = {};
  days.forEach((d) => {
    buckets[d] = [];
  });
  if (n === 0) return buckets;

  const half = Math.floor(n / 2);
  const third = Math.max(1, Math.floor(n / 3));

  // 日ごとに {id, base} を集める
  const raw = {};
  days.forEach((d) => {
    raw[d] = [];
  });

  orderedIds.forEach((id, i) => {
    const card = cards[id];
    if (!card) return; // 未投入は対象外

    let base = i % n;

    // スイープ中に除外を解除したカードは、基準日が過ぎていればその日に引き直す。
    // 移動は必ず未来方向。「有効なカードは出発までに必ず1回は出る」を壊さないため。
    const u = card.unsuspendedOn;
    if (u && raw[u] !== undefined) {
      const uIdx = days.indexOf(u);
      if (uIdx > base) base = uIdx;
    }

    raw[days[base]].push({ id, base: true });

    const reps = repsFor(card);
    const extra = new Set();
    if (reps >= 2) extra.add((base + half) % n);
    if (reps >= 3) extra.add((base + third) % n);
    extra.delete(base);
    extra.forEach((s) => raw[days[s]].push({ id, base: false }));
  });

  // 基準の1回目を先頭へ。上限で切り捨てられるのは常に追加分だけになる。
  // その中では苦手なカードを先に出す。
  days.forEach((d) => {
    raw[d].sort(
      (a, b) =>
        Number(b.base) - Number(a.base) ||
        (cards[b.id]?.lapses || 0) - (cards[a.id]?.lapses || 0) ||
        a.id.localeCompare(b.id)
    );
    buckets[d] = raw[d].map((e) => e.id);
  });

  return buckets;
}

// ---- セッションのキュー生成 ----

/**
 * その日のセッション内容を返す。
 *   { mode, reviewIds, newIds, overflow }
 * cards: { [id]: {id, box, due, lapses, lastSeen} }  すでに投入済みのカード
 * allPhrases: phrases.json の配列（この順序が投入順）
 * trip: { departure: 'YYYY-MM-DD' }
 */
export function buildSession(today, cards, allPhrases, trip, opts = {}) {
  const mode = modeFor(today, trip);

  if (mode === 'trip') {
    return { mode, reviewIds: [], newIds: [], overflow: 0 };
  }

  // 出題対象は active、「投入済みか」の判定は生の cards を使う。
  // 除外したカードを新規として出し直さないため、また除外も当日の新規枠を使うため。
  const active = activeCards(cards, allPhrases);
  const known = Object.values(active);

  if (mode === 'sweep') {
    const order = resolveSweepOrder(opts.sweepOrder, allPhrases);
    const plan = sweepPlan(order, active, trip);
    const all = plan[today] || [];
    return {
      mode,
      reviewIds: all.slice(0, SWEEP_CAP),
      newIds: [],
      overflow: Math.max(0, all.length - SWEEP_CAP),
    };
  }

  // --- 学習期 ---
  const due = known
    .filter((c) => diffDays(c.due, today) >= 0)
    .sort(
      (a, b) => (b.lapses || 0) - (a.lapses || 0) || dayNum(a.due) - dayNum(b.due)
    );

  const reviewIds = due.slice(0, REVIEW_CAP).map((c) => c.id);
  const overflow = Math.max(0, due.length - REVIEW_CAP);

  // 新規は1日 NEW_PER_DAY 枚まで。同じ日にセッションを何度実行しても増えない。
  // firstSeen は投入日で固定なので、途中で中断して再開した場合は残り枚数だけが出る。
  // 生の cards を数える。active だと除外したカードが枠を返してしまい、
  // 「必要なし」の連打でデッキを掘り進められる
  const introducedToday = Object.values(cards).filter((c) => c.firstSeen === today).length;
  const quota = Math.max(0, NEW_PER_DAY - introducedToday);

  const newIds = allPhrases
    .filter((p) => !cards[p.id])
    .slice(0, quota)
    .map((p) => p.id);

  return { mode, reviewIds, newIds, overflow };
}

/**
 * その日の分をもう一度やるための出題リスト。新規は追加しない。
 * 今日さわったカード（採点済み + 今日投入した分）を、間違えたものから順に返す。
 */
export function buildReplay(today, cards, allPhrases) {
  const active = activeCards(cards, allPhrases);
  const rankOf = (c) =>
    c.gradedOn === today ? SEVERITY[c.dayWorst] ?? 3 : 3;

  return Object.values(active)
    .filter((c) => c.gradedOn === today || c.firstSeen === today)
    .sort((a, b) => rankOf(a) - rankOf(b) || a.id.localeCompare(b.id))
    .slice(0, REVIEW_CAP)
    .map((c) => c.id);
}

/** 新規カードの初期状態。firstSeen は投入日で、以後変更しない */
export function introduce(id, today) {
  return {
    id,
    box: 1,
    lapses: 0,
    due: addDays(today, 1),
    firstSeen: today,
    lastSeen: today,
  };
}
