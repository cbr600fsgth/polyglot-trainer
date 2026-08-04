// srs.js の検証。node tools/test-srs.mjs で実行する。
// スイープ10日で全カード1周、1日の出題上限30/25枚などを実際に確認する。
//
// 出発日はアプリ本体でも端末のlocalStorageにしか持たないため、テストも架空の旅程で回す。
// 日付リテラルはこの TRIP を基準に組んであり、実在の旅程は含まれない。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as srs from '../js/srs.js';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${e.message}`);
    process.exitCode = 1;
  }
}

const phrases = JSON.parse(
  readFileSync(new URL('../data/phrases.json', import.meta.url))
).phrases;

// 架空の旅程。出発 2030-05-20、スイープ開始はその10日前の 2030-05-10、学習開始 2030-04-05
const TRIP = { departure: '2030-05-20' };
const START = '2030-04-05';

console.log('\n日付ユーティリティ');

check('addDays が月をまたぐ', () => {
  assert.equal(srs.addDays('2030-05-02', 1), '2030-05-03');
  assert.equal(srs.addDays('2030-05-03', -1), '2030-05-02');
  assert.equal(srs.addDays('2030-04-10', 30), '2030-05-10');
});

check('diffDays が学習期間を正しく数える', () => {
  assert.equal(srs.diffDays('2030-04-10', '2030-05-20'), 40);
  assert.equal(srs.diffDays('2030-04-10', '2030-05-19'), 39);
  assert.equal(srs.diffDays('2030-05-10', '2030-05-20'), 10);
});

console.log('\nモード判定');

check('学習 / スイープ / 旅行 の境界', () => {
  assert.equal(srs.modeFor('2030-04-10', TRIP), 'study');
  assert.equal(srs.modeFor('2030-05-09', TRIP), 'study');
  assert.equal(srs.modeFor('2030-05-10', TRIP), 'sweep');
  assert.equal(srs.modeFor('2030-05-19', TRIP), 'sweep');
  assert.equal(srs.modeFor('2030-05-20', TRIP), 'trip');
  assert.equal(srs.modeFor('2030-05-28', TRIP), 'trip');
});

console.log('\n第1段: 間隔は箱だけで決まる（残日数で圧縮しない）');

check('間隔は 1/2/4/8/14 日のまま。出発が近くても変わらない', () => {
  const spans = [];
  for (let box = 1; box <= 5; box++) {
    const early = srs.nextState({ id: 'x', box, lapses: 0, firstSeen: '2030-04-02' }, 'vague', '2030-04-05');
    const late = srs.nextState({ id: 'x', box, lapses: 0, firstSeen: '2030-04-02' }, 'vague', '2030-05-09');
    const a = srs.diffDays('2030-04-05', early.due);
    const b = srs.diffDays('2030-05-09', late.due);
    assert.equal(a, b, `箱${box} で開始直後(${a}日)と直前(${b}日)の間隔が違う`);
    spans.push(a);
  }
  assert.deepEqual(spans, srs.BOX_INTERVALS);
});

check('出発後に期限が飛んでもスイープが回収する', () => {
  // スイープ開始前日に箱5を正解すると次回は出発後になる。学習期には二度と出ない
  const c = srs.nextState({ id: 'greet-01', box: 4, lapses: 0, firstSeen: '2030-04-02' }, 'good', '2030-05-09');
  assert.equal(c.box, 5);
  assert.equal(c.due, '2030-05-23');
  assert.ok(srs.diffDays(TRIP.departure, c.due) > 0, '期限が出発前に収まってしまっている');

  // それでもスイープの割り当てには入る
  const plan = srs.sweepPlan([c.id], { [c.id]: c }, TRIP);
  const appears = srs.sweepDays(TRIP).some((d) => plan[d].includes(c.id));
  assert.ok(appears, 'スイープで出題されない');
});

console.log('\n第1段: 採点による状態遷移');

check('できた で箱が進み、間隔が伸びる', () => {
  let c = srs.introduce('x', '2030-04-10');
  assert.equal(c.box, 1);
  assert.equal(c.due, '2030-04-11');

  c = srs.nextState(c, 'good', '2030-04-11');
  assert.equal(c.box, 2);
  assert.equal(c.due, '2030-04-13'); // 箱2 = 2日
  c = srs.nextState(c, 'good', '2030-04-13');
  assert.equal(c.box, 3);
  assert.equal(c.due, '2030-04-17'); // 箱3 = 4日
});

check('投入日に できた を付けても昇格しない（翌日必ず復習する）', () => {
  let c = srs.introduce('x', '2030-04-10');
  c = srs.nextState(c, 'good', '2030-04-10');
  assert.equal(c.box, 1);
  assert.equal(c.due, '2030-04-11');
});

check('あいまい は箱を動かさない', () => {
  let c = { id: 'x', box: 3, lapses: 0, due: '2030-04-16' };
  c = srs.nextState(c, 'vague', '2030-04-16');
  assert.equal(c.box, 3);
  assert.equal(c.lapses, 0);
  assert.equal(c.due, '2030-04-20');
});

check('だめ で箱1に戻り lapses が増える', () => {
  let c = { id: 'x', box: 4, lapses: 1, due: '2030-04-21' };
  c = srs.nextState(c, 'again', '2030-04-21');
  assert.equal(c.box, 1);
  assert.equal(c.lapses, 2);
  assert.equal(c.due, '2030-04-22');
});

check('箱5で できた を繰り返しても箱5で止まる', () => {
  let c = { id: 'x', box: 5, lapses: 0, due: '2030-04-10' };
  c = srs.nextState(c, 'good', '2030-04-10');
  assert.equal(c.box, 5);
});


console.log('\n同日の再挑戦（最悪の採点が勝つ）');

check('朝に間違えて夜に正解しても、箱1のまま翌日に出る', () => {
  let c = { id: 'x', box: 3, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  c = srs.nextState(c, 'again', '2030-04-21');
  assert.equal(c.box, 1);
  assert.equal(c.lapses, 1);

  c = srs.nextState(c, 'good', '2030-04-21'); // 同じ日に再挑戦して正解
  assert.equal(c.box, 1, '正解で昇格してしまっている');
  assert.equal(c.due, '2030-04-22', '翌日に出なくなっている');
  assert.equal(c.dayWorst, 'again');
});

check('同じ日に何度間違えても lapses は1しか増えない', () => {
  let c = { id: 'x', box: 3, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  for (let i = 0; i < 5; i++) c = srs.nextState(c, 'again', '2030-04-21');
  assert.equal(c.lapses, 1);
});

check('別の日に間違えれば lapses は増える', () => {
  let c = { id: 'x', box: 3, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  c = srs.nextState(c, 'again', '2030-04-21');
  c = srs.nextState(c, 'again', '2030-04-22');
  assert.equal(c.lapses, 2);
});

check('先に正解して後で間違えた場合も箱1に落ちる', () => {
  let c = { id: 'x', box: 3, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  c = srs.nextState(c, 'good', '2030-04-21');
  assert.equal(c.box, 4);
  c = srs.nextState(c, 'again', '2030-04-21');
  assert.equal(c.box, 1);
  assert.equal(c.lapses, 1);
  assert.equal(c.due, '2030-04-22');
});

check('全問正解のまま何度繰り返しても箱は1つしか進まない', () => {
  let c = { id: 'x', box: 2, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  for (let i = 0; i < 5; i++) c = srs.nextState(c, 'good', '2030-04-21');
  assert.equal(c.box, 3, '繰り返すほど箱が進んでしまっている');
  assert.equal(c.due, '2030-04-25'); // 箱3 = 4日
});

check('あいまい を挟んでも最悪の採点が残る', () => {
  let c = { id: 'x', box: 4, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  c = srs.nextState(c, 'good', '2030-04-21');
  c = srs.nextState(c, 'vague', '2030-04-21');
  assert.equal(c.box, 4, 'あいまいなので箱4のまま');
  c = srs.nextState(c, 'good', '2030-04-21');
  assert.equal(c.box, 4, '最悪が あいまい なので昇格しない');
});

check('翌日は前日の記録に引きずられず、新しく判定される', () => {
  let c = { id: 'x', box: 3, lapses: 0, due: '2030-04-21', firstSeen: '2030-04-02' };
  c = srs.nextState(c, 'again', '2030-04-21'); // 箱1へ
  c = srs.nextState(c, 'good', '2030-04-22'); // 翌日に正解
  assert.equal(c.box, 2, '前日の again を引き継いでしまっている');
  assert.equal(c.due, '2030-04-24');
});

console.log('\n再挑戦の出題リスト');

check('今日さわったカードだけを、間違えたものから順に返す', () => {
  const cards = {
    a: { id: 'a', box: 1, lapses: 0, gradedOn: '2030-04-21', dayWorst: 'good', firstSeen: '2030-04-02' },
    b: { id: 'b', box: 1, lapses: 1, gradedOn: '2030-04-21', dayWorst: 'again', firstSeen: '2030-04-02' },
    c: { id: 'c', box: 1, lapses: 0, gradedOn: '2030-04-21', dayWorst: 'vague', firstSeen: '2030-04-02' },
    d: { id: 'd', box: 1, lapses: 0, firstSeen: '2030-04-21' }, // 今日投入・未採点
    e: { id: 'e', box: 2, lapses: 0, gradedOn: '2030-04-20', dayWorst: 'good', firstSeen: '2030-04-02' },
  };
  const ids = srs.buildReplay('2030-04-21', cards);
  assert.deepEqual(ids, ['b', 'c', 'a', 'd'], '順序または対象が違う');
  assert.ok(!ids.includes('e'), '前日のカードが混ざっている');
});

check('何もしていない日は再挑戦リストが空', () => {
  assert.deepEqual(srs.buildReplay('2030-04-21', {}), []);
});

check('再挑戦リストは30枚で打ち切る', () => {
  const cards = {};
  for (let i = 0; i < 40; i++) {
    cards[`c${i}`] = {
      id: `c${i}`, box: 1, lapses: 0,
      gradedOn: '2030-04-21', dayWorst: 'good', firstSeen: '2030-04-02',
    };
  }
  assert.equal(srs.buildReplay('2030-04-21', cards).length, srs.REVIEW_CAP);
});

console.log('\n第2段: 最終スイープ');

check('スイープ期間は出発の10日前から出発前日までの10日', () => {
  const days = srs.sweepDays(TRIP);
  assert.equal(days.length, 10);
  assert.equal(days[0], '2030-05-10');
  assert.equal(days[9], '2030-05-19');
});

// 150枚の想定カード（idの並びがカリキュラム順）
function fakeDeck(lapsesOf) {
  const ids = Array.from({ length: 150 }, (_, i) => `c${String(i).padStart(3, '0')}`);
  const cards = Object.fromEntries(
    ids.map((id, i) => [id, { id, box: 1, lapses: lapsesOf(i), due: '2030-05-03' }])
  );
  return { ids, cards };
}

check('lapses ゼロなら全カードがちょうど1回・15枚/日', () => {
  const { ids, cards } = fakeDeck(() => 0);
  const plan = srs.sweepPlan(ids, cards, TRIP);
  const days = srs.sweepDays(TRIP);

  const all = days.flatMap((d) => plan[d]);
  assert.equal(all.length, 150);
  assert.equal(new Set(all).size, 150, '重複または欠落がある');
  days.forEach((d) => assert.equal(plan[d].length, 15, `${d} が ${plan[d].length}枚`));
});

check('弱点カードは2〜3回配分され、同じ日には重複しない', () => {
  const { ids, cards } = fakeDeck((i) => (i < 20 ? 5 : i < 60 ? 2 : 0));
  const plan = srs.sweepPlan(ids, cards, TRIP);
  const days = srs.sweepDays(TRIP);
  const all = days.flatMap((d) => plan[d]);

  const count = (id) => all.filter((x) => x === id).length;
  assert.equal(count('c000'), 3, 'lapses 5 は3回');
  assert.equal(count('c025'), 2, 'lapses 2 は2回');
  assert.equal(count('c100'), 1, 'lapses 0 は1回');

  assert.equal(new Set(all).size, 150, '全カードが登場していない');

  days.forEach((d) => {
    assert.equal(new Set(plan[d]).size, plan[d].length, `${d} に同じカードが2枚ある`);
  });
});

check('弱点を足しても1日の枚数が上限25枚に収まる', () => {
  const { ids, cards } = fakeDeck((i) => (i < 20 ? 5 : i < 60 ? 2 : 0));
  const plan = srs.sweepPlan(ids, cards, TRIP);
  srs.sweepDays(TRIP).forEach((d) => {
    assert.ok(plan[d].length <= srs.SWEEP_CAP, `${d} が ${plan[d].length}枚`);
  });
});

check('上限で切り捨てられるのは追加分だけで、1回目は必ず残る', () => {
  // 全カードが lapses 5（3回配分）→ 45枚/日になり上限25で切られる
  const { ids, cards } = fakeDeck(() => 5);
  const plan = srs.sweepPlan(ids, cards, TRIP);
  const days = srs.sweepDays(TRIP);

  // 各日の先頭15枚（=1回目の割り当て）を集めれば全150枚が揃う
  const kept = new Set(days.flatMap((d) => plan[d].slice(0, srs.SWEEP_CAP)));
  assert.equal(kept.size, 150, `切り捨て後に ${kept.size}枚しか残っていない`);
});

check('lapses が途中で変わっても1回目の割り当ては動かない', () => {
  const { ids, cards } = fakeDeck(() => 0);
  const before = srs.sweepPlan(ids, cards, TRIP);

  // スイープ中に一部カードで つまずいた状況を作る
  ids.slice(0, 40).forEach((id) => {
    cards[id].lapses = 3;
  });
  const after = srs.sweepPlan(ids, cards, TRIP);

  const days = srs.sweepDays(TRIP);
  days.forEach((d) => {
    before[d].forEach((id) => {
      assert.ok(after[d].includes(id), `${id} が ${d} から消えた`);
    });
  });
});

console.log('\nセッション生成');

check('学習期は復習30枚で打ち切り、超過を報告する', () => {
  const cards = {};
  for (let i = 0; i < 45; i++) {
    cards[`c${i}`] = { id: `c${i}`, box: 1, lapses: 0, due: '2030-04-21' };
  }
  const s = srs.buildSession('2030-04-26', cards, phrases, TRIP);
  assert.equal(s.mode, 'study');
  assert.equal(s.reviewIds.length, 30);
  assert.equal(s.overflow, 15);
  assert.equal(s.newIds.length, 5);
});

check('未投入のフレーズから先頭5件を新規に選ぶ', () => {
  const s = srs.buildSession('2030-04-10', {}, phrases, TRIP);
  assert.deepEqual(s.newIds, phrases.slice(0, 5).map((p) => p.id));
});

check('同じ日に2回目のセッションを開いても新規は増えない', () => {
  const cards = {};
  const first = srs.buildSession('2030-04-10', cards, phrases, TRIP);
  assert.equal(first.newIds.length, 5);
  first.newIds.forEach((id) => {
    cards[id] = srs.introduce(id, '2030-04-10');
  });

  const second = srs.buildSession('2030-04-10', cards, phrases, TRIP);
  assert.equal(second.newIds.length, 0, `2回目に ${second.newIds.length}枚 出ている`);
  assert.equal(second.reviewIds.length, 0, '当日投入分は当日の復習にも出ない');
});

check('途中で中断した場合は残り枚数だけ出る', () => {
  const cards = {};
  phrases.slice(0, 3).forEach((p) => {
    cards[p.id] = srs.introduce(p.id, '2030-04-10');
  });
  const s = srs.buildSession('2030-04-10', cards, phrases, TRIP);
  assert.equal(s.newIds.length, 2);
  assert.deepEqual(s.newIds, phrases.slice(3, 5).map((p) => p.id));
});

check('翌日になれば再び5枚出る', () => {
  const cards = {};
  phrases.slice(0, 5).forEach((p) => {
    cards[p.id] = srs.introduce(p.id, '2030-04-10');
  });
  const s = srs.buildSession('2030-04-11', cards, phrases, TRIP);
  assert.equal(s.newIds.length, 5);
  assert.equal(s.reviewIds.length, 5, '前日の5枚が復習に出る');
});

check('採点しても firstSeen は変わらない', () => {
  let c = srs.introduce('greet-01', '2030-04-10');
  assert.equal(c.firstSeen, '2030-04-10');
  c = srs.nextState(c, 'good', '2030-04-11');
  assert.equal(c.firstSeen, '2030-04-10');
  assert.equal(c.lastSeen, '2030-04-11');
  c = srs.nextState(c, 'again', '2030-04-13');
  assert.equal(c.firstSeen, '2030-04-10');
});

check('1日に何度開いても投入は5枚で止まる（10回連続）', () => {
  const cards = {};
  for (let i = 0; i < 10; i++) {
    const s = srs.buildSession('2030-04-10', cards, phrases, TRIP);
    s.newIds.forEach((id) => {
      cards[id] = srs.introduce(id, '2030-04-10');
    });
  }
  assert.equal(Object.keys(cards).length, 5, `${Object.keys(cards).length}枚 投入された`);
});

check('全部投入済みなら新規はゼロ', () => {
  const cards = Object.fromEntries(
    phrases.map((p) => [p.id, { id: p.id, box: 5, lapses: 0, due: '2030-06-01' }])
  );
  const s = srs.buildSession('2030-04-21', cards, phrases, TRIP);
  assert.equal(s.newIds.length, 0);
});

check('スイープ期は新規ゼロで、箱の期限を無視する', () => {
  const cards = Object.fromEntries(
    phrases.map((p) => [p.id, { id: p.id, box: 5, lapses: 0, due: '2030-09-01' }])
  );
  const s = srs.buildSession('2030-05-10', cards, phrases, TRIP);
  assert.equal(s.mode, 'sweep');
  assert.equal(s.newIds.length, 0);
  assert.ok(s.reviewIds.length > 0, '期限が未来でもスイープでは出題される');
});

check('旅行モードは出題ゼロ', () => {
  const cards = Object.fromEntries(
    phrases.map((p) => [p.id, { id: p.id, box: 1, lapses: 0, due: '2030-04-02' }])
  );
  const s = srs.buildSession('2030-05-22', cards, phrases, TRIP);
  assert.equal(s.mode, 'trip');
  assert.equal(s.reviewIds.length, 0);
  assert.equal(s.newIds.length, 0);
});

console.log('\n45日通し実行（学習開始日から・毎日サボらずに実施した場合）');

// 決定的な擬似乱数
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gradeOf = (card) => {
  const r = rand();
  // 何度も間違えたカードほど正解しやすくなる方向に寄せる
  const bonus = Math.min((card.lapses || 0) * 0.05, 0.2);
  if (r < 0.1 - bonus / 2) return 'again';
  if (r < 0.3 - bonus) return 'vague';
  return 'good';
};

const cards = {};
const log = [];
let introducedBy = null;

for (let d = 0; d < 45; d++) {
  const today = srs.addDays('2030-04-05', d);
  const s = srs.buildSession(today, cards, phrases, TRIP);

  s.newIds.forEach((id) => {
    cards[id] = srs.introduce(id, today);
  });
  s.reviewIds.forEach((id) => {
    if (cards[id]) cards[id] = srs.nextState(cards[id], gradeOf(cards[id]), today);
  });

  if (!introducedBy && Object.keys(cards).length === phrases.length) introducedBy = today;

  log.push({
    day: today,
    mode: s.mode,
    review: s.reviewIds.length,
    fresh: s.newIds.length,
    shown: s.reviewIds.length + s.newIds.length,
    overflow: s.overflow,
    seen: s.reviewIds,
  });
}

check(`150フレーズが5枚/日で30日で投入し終わる（実測 ${introducedBy}）`, () => {
  assert.equal(Object.keys(cards).length, phrases.length);
  assert.equal(introducedBy, '2030-05-04');
});

check('1日の出題枚数が常に35枚以下（復習30 + 新規5）', () => {
  log.forEach((l) => {
    assert.ok(l.shown <= srs.REVIEW_CAP + srs.NEW_PER_DAY, `${l.day} が ${l.shown}枚`);
  });
});

check('スイープ期の10日で全150フレーズが最低1回出題される', () => {
  const sweep = log.filter((l) => l.mode === 'sweep');
  assert.equal(sweep.length, 10);
  const seen = new Set(sweep.flatMap((l) => l.seen));
  const missing = phrases.filter((p) => !seen.has(p.id)).map((p) => p.id);
  assert.deepEqual(missing, [], `未出題: ${missing.join(', ')}`);
});

check('スイープ期の1日の出題が25枚以下', () => {
  log
    .filter((l) => l.mode === 'sweep')
    .forEach((l) => assert.ok(l.shown <= srs.SWEEP_CAP, `${l.day} が ${l.shown}枚`));
});

// 繰り越しはゼロにはならない。150枚を1日30枚で回す以上、詰まる日は出る。
// 重要なのは「際限なく積み上がらないこと」と「未消化のカードもスイープで必ず出ること」。
// 後者は上の網羅テストで確認済み。
check('繰り越しが際限なく積み上がらない', () => {
  const study = log.filter((l) => l.mode === 'study');
  const worst = Math.max(...study.map((l) => l.overflow));
  assert.ok(worst <= 40, `繰り越しの最大が ${worst}枚。上限30枚に対して多すぎる`);

  // 単調増加ではなく、途中で必ず減る日があること
  const tail = study.slice(-10);
  const clears = tail.filter((l, i) => i > 0 && l.overflow < tail[i - 1].overflow);
  assert.ok(
    clears.length > 0,
    `最後の10日で繰り越しが一度も減っていない: ${tail.map((l) => l.overflow).join(',')}`
  );
});

console.log('\n45日通し実行（学習開始日から・毎日さらに再挑戦を2回ずつ実施した場合）');

// 再挑戦を繰り返しても、新規の投入ペースと将来の負荷が崩れないことを確認する
let seed2 = 7;
const rand2 = () => ((seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gradeOf2 = () => {
  const r = rand2();
  if (r < 0.15) return 'again';
  if (r < 0.35) return 'vague';
  return 'good';
};

const rcards = {};
const rlog = [];
const gradedDays = {}; // id → 採点した日の集合
let rIntroducedBy = null;

const gradeIt = (id, today) => {
  rcards[id] = srs.nextState(rcards[id], gradeOf2(), today);
  (gradedDays[id] = gradedDays[id] || new Set()).add(today);
};

for (let d = 0; d < 45; d++) {
  const today = srs.addDays('2030-04-05', d);

  const s = srs.buildSession(today, rcards, phrases, TRIP);
  s.newIds.forEach((id) => {
    rcards[id] = srs.introduce(id, today);
  });
  s.reviewIds.forEach((id) => {
    if (rcards[id]) gradeIt(id, today);
  });

  // 同じ日に2回もう一度やる
  let replayTotal = 0;
  for (let r = 0; r < 2; r++) {
    const ids = srs.buildReplay(today, rcards);
    replayTotal += ids.length;
    ids.forEach((id) => gradeIt(id, today));
  }

  if (!rIntroducedBy && Object.keys(rcards).length === phrases.length) rIntroducedBy = today;

  rlog.push({
    day: today,
    mode: s.mode,
    required: s.reviewIds.length + s.newIds.length,
    replay: replayTotal,
    seen: s.reviewIds,
  });
}

check(`再挑戦しても新規の投入ペースは変わらない（実測 ${rIntroducedBy}）`, () => {
  assert.equal(Object.keys(rcards).length, phrases.length);
  assert.equal(rIntroducedBy, '2030-05-04');
});

check('再挑戦しても必須セッションは35枚以下', () => {
  rlog.forEach((l) => {
    assert.ok(l.required <= srs.REVIEW_CAP + srs.NEW_PER_DAY, `${l.day} が ${l.required}枚`);
  });
});

check('再挑戦しても最終スイープで全150フレーズが出題される', () => {
  const seen = new Set(rlog.filter((l) => l.mode === 'sweep').flatMap((l) => l.seen));
  const missing = phrases.filter((p) => !seen.has(p.id)).map((p) => p.id);
  assert.deepEqual(missing, [], `未出題: ${missing.join(', ')}`);
});

check('lapses が「採点した日数」を超えない（1日に何度間違えても1回）', () => {
  Object.values(rcards).forEach((c) => {
    const days = gradedDays[c.id] ? gradedDays[c.id].size : 0;
    assert.ok(
      (c.lapses || 0) <= days,
      `${c.id} は ${days}日しか採点していないのに lapses が ${c.lapses}`
    );
  });
});

check('再挑戦しても最終スイープの1日の出題が25枚以下', () => {
  rlog
    .filter((l) => l.mode === 'sweep')
    .forEach((l) => assert.ok(l.required <= srs.SWEEP_CAP, `${l.day} が ${l.required}枚`));
});

console.log('\n日別の出題枚数');
const bars = log.map((l) => {
  const bar = '#'.repeat(Math.round(l.shown / 2));
  const tag = l.mode === 'sweep' ? 'S' : ' ';
  return `  ${l.day} ${tag} ${String(l.shown).padStart(2)} ${bar}`;
});
console.log(bars.join('\n'));

console.log(`\n${passed} 件成功${process.exitCode ? '、失敗あり' : ''}`);
