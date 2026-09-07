// js/store.js の検証。node tools/test-store.mjs で実行する。
//
// store.js は localStorage と JSON しか使わず DOM に触らないため、動的 import の前に
// シムを置けばそのままテストできる。ブラウザは起動しない。
//
// 検証項目は docs/SPEC-multilingual.md の 8.3 に対応する。

import assert from 'node:assert/strict';

// ---- localStorage のシム ----

let failNextWrite = false;
function installStorage() {
  let m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (failNextWrite) throw new Error('QuotaExceededError（シム）');
      m.set(k, String(v));
    },
    removeItem: (k) => void m.delete(k),
    clear: () => void (m = new Map()),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    _dump: () => Object.fromEntries(m),
  };
}
installStorage();

const store = await import('../js/store.js');

// ---- テストハーネス ----

/** 意図的に保存を失敗させるテストでは store.js の console.error を黙らせる */
function quiet(fn) {
  const orig = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = orig; }
}

let passed = 0;
function check(name, fn) {
  localStorage.clear();
  failNextWrite = false;
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

const card = (id, over = {}) => ({
  id, box: 1, lapses: 0, due: '2030-04-11',
  firstSeen: '2030-04-10', lastSeen: '2030-04-10', ...over,
});

// ---- 移行 ----

console.log('\n旧データからの移行');

check('旧データ pt.cards が poly.progress.pt に移る', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ 'greet-01': card('greet-01') }));
  const r = store.migrateLegacy();
  assert.equal(r.migrated, true);
  assert.equal(r.count, 1);
  assert.deepEqual(Object.keys(store.loadProgress('pt')), ['greet-01']);
});

check('移行は2回目以降なにもしない（べき等）', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  assert.equal(store.migrateLegacy().migrated, true);
  const second = store.migrateLegacy();
  assert.equal(second.migrated, false);
  assert.equal(second.reason, 'already');
});

check('移行後も pt.cards / pt.meta / pt.trip は残る', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  localStorage.setItem('pt.meta', JSON.stringify({ streak: 3 }));
  localStorage.setItem('pt.trip', JSON.stringify({ departure: '2030-05-20' }));
  store.migrateLegacy();
  assert.notEqual(localStorage.getItem('pt.cards'), null);
  assert.notEqual(localStorage.getItem('pt.meta'), null);
  assert.notEqual(localStorage.getItem('pt.trip'), null);
});

check('poly.progress が既にあれば移行しない', () => {
  store.saveProgress('es', { x: card('x') });
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  assert.equal(store.migrateLegacy().reason, 'already');
  assert.deepEqual(store.loadProgress('pt'), {});
});

check('poly.progress が空オブジェクトでも移行は再実行されない', () => {
  assert.equal(store.migrateLegacy().reason, 'fresh');   // 空の器を書く
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  assert.equal(store.migrateLegacy().reason, 'already'); // 器があるので走らない
  assert.deepEqual(store.loadProgress('pt'), {});
});

check('旧データが無い新規利用者では空の器だけ作る', () => {
  const r = store.migrateLegacy();
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'fresh');
  assert.equal(localStorage.getItem('poly.progress'), '{}');
});

check('pt.cards が壊れていても起動を止めない', () => {
  localStorage.setItem('pt.cards', '{壊れたJSON');
  const r = store.migrateLegacy();
  assert.equal(r.migrated, false);
  assert.equal(r.reason, 'legacy-unreadable');
  assert.equal(localStorage.getItem('poly.progress'), '{}');
});

check('pt.trip が poly.trips.pt に移る', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  localStorage.setItem('pt.trip', JSON.stringify({ departure: '2030-05-20' }));
  store.migrateLegacy();
  assert.deepEqual(store.loadTrip('pt'), { departure: '2030-05-20' });
});

check('旧 meta のストリークが引き継がれる', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  localStorage.setItem('pt.meta', JSON.stringify({ streak: 7, totalSessions: 20, lastDone: '2030-04-10' }));
  store.migrateLegacy();
  const m = store.loadMeta();
  assert.equal(m.streak, 7);
  assert.equal(m.totalSessions, 20);
  assert.equal(m.migratedFrom, 'pt.*');
});

check('modeOverride は移行で捨てられる', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  localStorage.setItem('pt.meta', JSON.stringify({ streak: 1, modeOverride: 'sweep' }));
  store.migrateLegacy();
  assert.equal('modeOverride' in store.loadMeta(), false);
});

check('移行で主言語が pt に設定される', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  store.migrateLegacy();
  assert.equal(store.loadSettings().primary, 'pt');
});

check('force 指定なら pt スロットを旧データで置き換える', () => {
  store.saveProgress('pt', { old: card('old') });
  store.saveProgress('es', { keep: card('keep') });
  localStorage.setItem('pt.cards', JSON.stringify({ fresh: card('fresh') }));
  const r = store.migrateLegacy({ force: true });
  assert.equal(r.migrated, true);
  assert.deepEqual(Object.keys(store.loadProgress('pt')), ['fresh']);
  assert.deepEqual(Object.keys(store.loadProgress('es')), ['keep']);  // 他言語は無傷
});

check('legacyPresent が旧データの有無を返す', () => {
  assert.equal(store.legacyPresent(), false);
  localStorage.setItem('pt.cards', '{}');
  assert.equal(store.legacyPresent(), true);
});

// ---- 言語ごとの分離 ----

console.log('\n言語ごとの分離');

check('saveProgress(lang) は他言語の進捗を書き換えない', () => {
  store.saveProgress('pt', { a: card('a') });
  store.saveProgress('es', { b: card('b') });
  store.saveProgress('pt', { a: card('a'), c: card('c') });
  assert.deepEqual(Object.keys(store.loadProgress('pt')).sort(), ['a', 'c']);
  assert.deepEqual(Object.keys(store.loadProgress('es')), ['b']);
});

check('saveCard は1枚だけを差し替え、他言語も他カードも保つ', () => {
  store.saveProgress('pt', { a: card('a'), b: card('b') });
  store.saveProgress('it', { z: card('z') });
  store.saveCard('pt', card('a', { box: 4 }));
  assert.equal(store.loadProgress('pt').a.box, 4);
  assert.equal(store.loadProgress('pt').b.box, 1);
  assert.deepEqual(Object.keys(store.loadProgress('it')), ['z']);
});

check('saveCard は未知の言語にも書ける（store は言語一覧を持たない）', () => {
  assert.equal(store.saveCard('fr', card('a')), true);
  assert.deepEqual(Object.keys(store.loadProgress('fr')), ['a']);
});

check('resetProgress(lang) は他言語とストリークを消さない', () => {
  store.saveProgress('pt', { a: card('a') });
  store.saveProgress('es', { b: card('b') });
  store.saveMeta({ streak: 5 });
  store.saveTrip('pt', { departure: '2030-05-20' });
  store.resetProgress('pt');
  assert.deepEqual(store.loadProgress('pt'), {});
  assert.deepEqual(Object.keys(store.loadProgress('es')), ['b']);
  assert.equal(store.loadMeta().streak, 5);
  assert.deepEqual(store.loadTrip('pt'), { departure: '2030-05-20' });  // 出発日は残す
});

check('resetAll は poly.* だけ消し pt.* を残す', () => {
  localStorage.setItem('pt.cards', JSON.stringify({ a: card('a') }));
  store.saveProgress('pt', { a: card('a') });
  store.saveMeta({ streak: 3 });
  store.saveSettings({ primary: 'es' });
  store.resetAll();
  assert.equal(localStorage.getItem('poly.progress'), null);
  assert.equal(localStorage.getItem('poly.meta'), null);
  assert.equal(localStorage.getItem('poly.settings'), null);
  assert.notEqual(localStorage.getItem('pt.cards'), null);
});

check('languagesWithProgress は空スロットを数えない', () => {
  store.saveProgress('pt', { a: card('a') });
  store.saveProgress('es', {});
  assert.deepEqual(store.languagesWithProgress(), ['pt']);
});

// ---- 旅程 ----

console.log('\n旅程（言語ごと）');

check('出発日を言語ごとに持てる', () => {
  store.saveTrip('pt', { departure: '2030-05-20' });
  store.saveTrip('es', { departure: '2031-03-01' });
  assert.equal(store.loadTrip('pt').departure, '2030-05-20');
  assert.equal(store.loadTrip('es').departure, '2031-03-01');
  assert.equal(store.loadTrip('it'), null);
});

check('出発日を保存し直しても凍結したスイープ順は消えない', () => {
  store.saveTrip('pt', { departure: '2030-05-20' });
  store.saveSweepOrder('pt', ['a', 'b', 'c']);
  store.saveTrip('pt', { departure: '2030-05-25' });
  assert.deepEqual(store.loadSweepOrder('pt'), ['a', 'b', 'c']);
  assert.equal(store.loadTrip('pt').departure, '2030-05-25');
});

check('clearSweepOrder はスイープ順だけを消す', () => {
  store.saveTrip('pt', { departure: '2030-05-20' });
  store.saveSweepOrder('pt', ['a']);
  store.clearSweepOrder('pt');
  assert.equal(store.loadSweepOrder('pt'), null);
  assert.equal(store.loadTrip('pt').departure, '2030-05-20');
});

check('resetProgress はスイープ順も消す', () => {
  store.saveTrip('pt', { departure: '2030-05-20' });
  store.saveSweepOrder('pt', ['a']);
  store.resetProgress('pt');
  assert.equal(store.loadSweepOrder('pt'), null);
});

check('saveTrip は未知のキーを取り込まない', () => {
  store.saveTrip('pt', { departure: '2030-05-20', secret: 'x' });
  assert.equal('secret' in store.loadTrip('pt'), false);
});

// ---- メタ ----

console.log('\nメタ（言語横断）');

check('ストリークは言語をまたいで1本', () => {
  let m = store.loadMeta();
  m = store.recordSession(m, '2030-04-10', '2030-04-09');
  assert.equal(m.streak, 1);
  m = store.recordSession(store.loadMeta(), '2030-04-11', '2030-04-10');
  assert.equal(m.streak, 2);
  // 言語を切り替えても meta は共通なので継続する
  store.setPrimary('es');
  assert.equal(store.loadMeta().streak, 2);
});

check('同じ日に2回完了してもストリークは増えない', () => {
  let m = store.recordSession(store.loadMeta(), '2030-04-10', '2030-04-09');
  m = store.recordSession(m, '2030-04-10', '2030-04-09');
  assert.equal(m.streak, 1);
  assert.equal(m.totalSessions, 1);
});

// ---- 設定 ----

console.log('\n設定');

check('未設定なら primary は null（データ側の既定に従う）', () => {
  assert.equal(store.loadSettings().primary, null);
});

check('setPrimary は showLangs を壊さない', () => {
  store.saveSettings({ primary: 'pt', showLangs: ['pt', 'es'] });
  store.setPrimary('it');
  const s = store.loadSettings();
  assert.equal(s.primary, 'it');
  assert.deepEqual(s.showLangs, ['pt', 'es']);
});

// ---- 入出力 ----

console.log('\n書き出しと読み込み');

check('version 3 のJSONを往復できる', () => {
  store.saveProgress('pt', { a: card('a', { box: 3 }) });
  store.saveProgress('it', { b: card('b', { suspended: true, suspendedOn: '2030-04-20' }) });
  store.saveTrip('pt', { departure: '2030-05-20' });
  store.saveSweepOrder('pt', ['a']);
  store.saveMeta({ streak: 9, totalSessions: 30, lastDone: '2030-04-20' });
  store.saveSettings({ primary: 'it', showLangs: null });
  const json = store.exportJSON();

  const parsed = JSON.parse(json);
  assert.equal(parsed.kind, 'polyglot-trainer-progress');
  assert.equal(parsed.version, 3);

  store.resetAll();
  const r = store.importJSON(json);
  assert.equal(r.version, 3);
  assert.equal(store.loadProgress('pt').a.box, 3);
  assert.equal(store.loadProgress('it').b.suspended, true);
  assert.deepEqual(store.loadSweepOrder('pt'), ['a']);
  assert.equal(store.loadMeta().streak, 9);
  assert.equal(store.loadSettings().primary, 'it');
});

check('version 2 のJSONを読み込むと pt に入り、es/it は残る', () => {
  store.saveProgress('es', { keep: card('keep') });
  store.saveProgress('it', { keep2: card('keep2') });
  const old = JSON.stringify({
    version: 2,
    cards: { 'greet-01': card('greet-01', { box: 5 }) },
    meta: { streak: 4, modeOverride: 'sweep' },
    trip: { departure: '2030-05-20' },
  });
  const r = store.importJSON(old);
  assert.deepEqual(r.langs, ['pt']);
  assert.equal(store.loadProgress('pt')['greet-01'].box, 5);
  assert.deepEqual(Object.keys(store.loadProgress('es')), ['keep']);
  assert.deepEqual(Object.keys(store.loadProgress('it')), ['keep2']);
  assert.equal(store.loadTrip('pt').departure, '2030-05-20');
  assert.equal(store.loadMeta().streak, 4);
});

check('version 3 の読み込みはファイルに無い言語を消さない', () => {
  store.saveProgress('es', { keep: card('keep') });
  const json = JSON.stringify({ version: 3, progress: { pt: { a: card('a') } } });
  store.importJSON(json);
  assert.deepEqual(Object.keys(store.loadProgress('es')), ['keep']);
  assert.deepEqual(Object.keys(store.loadProgress('pt')), ['a']);
});

check('importJSON は未知のキーを取り込まない（modeOverride混入の防止）', () => {
  store.importJSON(JSON.stringify({
    version: 3,
    progress: { pt: {} },
    meta: { streak: 2, modeOverride: 'sweep', evil: 1 },
    settings: { primary: 'pt', evil: 1 },
  }));
  const m = store.loadMeta();
  assert.equal('modeOverride' in m, false);
  assert.equal('evil' in m, false);
  assert.equal('evil' in store.loadSettings(), false);
});

check('壊れたJSONの読み込みは1バイトも書き込まない', () => {
  store.saveProgress('pt', { a: card('a') });
  const before = localStorage.getItem('poly.progress');
  assert.throws(() => store.importJSON('{壊れた'), /.*/);
  assert.equal(localStorage.getItem('poly.progress'), before);
});

check('progress も cards も無いJSONは弾く', () => {
  assert.throws(() => store.importJSON(JSON.stringify({ version: 3, meta: {} })),
    /progress も cards も見つかりません/);
});

check('言語スロットの形式が違えば全体を書き込まない', () => {
  store.saveProgress('pt', { a: card('a') });
  const before = localStorage.getItem('poly.progress');
  assert.throws(
    () => store.importJSON(JSON.stringify({ version: 3, progress: { pt: { b: card('b') }, es: [] } })),
    /es の進捗の形式が違います/
  );
  assert.equal(localStorage.getItem('poly.progress'), before);
});

// ---- 保存失敗 ----

console.log('\n保存失敗の扱い');

check('保存に失敗したとき saveCard が false を返す', () => {
  failNextWrite = true;
  quiet(() => assert.equal(store.saveCard('pt', card('a')), false));
});

check('保存に失敗したとき importJSON は例外を投げる', () => {
  failNextWrite = true;
  quiet(() => assert.throws(
    () => store.importJSON(JSON.stringify({ version: 3, progress: { pt: {} } })),
    /保存に失敗しました/
  ));
});

console.log(`\n${passed} 件成功${process.exitCode ? '、失敗あり' : ''}`);
