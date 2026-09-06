// data/phrases.json (v2) の検証。node tools/check-phrases.mjs [path] で実行する。
// ERROR は exit 1、WARN は表示のみで exit 0。すべてのメッセージにフレーズidと配列位置を付ける。
//
// 検証項目は docs/SPEC-multilingual.md の 8.1 に対応する。番号は仕様書の項番と一致させてある。
// 自己テストは node tools/check-phrases.mjs --self-test。専用のテストファイルは作らない。
//
// Node標準機能のみ。依存ゼロ。

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// スイープの網羅保証の上限。SWEEP_DAYS(10) × SWEEP_CAP(25)。js/srs.js と一致させる
const SWEEP_DAYS = 10;
const SWEEP_CAP = 25;
const CAPACITY = SWEEP_DAYS * SWEEP_CAP;
const CAPACITY_WARN = 200;

const LANG_KEY = /^[a-z]{2}(-[A-Z]{2})?$/;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// カタカナ + 、 + ー(U+30FCは30A0-30FFの中) + 空白 + /
const KANA_RE = /^[゠-ヿ、\s/]+$/;
const LANG_FIELDS = new Set(['text', 'kana', 'note']);
const LEGACY_FIELDS = ['pt', 'it', 'kana', 'note'];
const TERMINAL = /[.?!…]$/;

// ---- 検証本体 ----

/**
 * @param {any} data パース済みのフレーズファイル
 * @param {{raw?: string, path?: string, git?: boolean}} opts
 * @returns {{errors: {code,msg}[], warns: ..., infos: ..., report: object|null}}
 */
export function validate(data, opts = {}) {
  const errors = [];
  const warns = [];
  const infos = [];
  const err = (code, msg) => errors.push({ code, msg });
  const warn = (code, msg) => warns.push({ code, msg });
  const info = (code, msg) => infos.push({ code, msg });

  // --- 1. 生テキストの体裁 ---
  if (typeof opts.raw === 'string') {
    if (opts.raw.charCodeAt(0) === 0xfeff) warn('W1', 'BOM が付いている。UTF-8 (BOMなし) で保存する');
    if (!opts.raw.endsWith('\n')) warn('W1', 'ファイルが改行で終わっていない');
  }

  // --- 2..4. envelope ---
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    err('E2', 'トップレベルがオブジェクトではない');
    return { errors, warns, infos, report: null };
  }
  if (data.kind !== 'phrases') {
    err('E2', `kind が "phrases" ではない: ${JSON.stringify(data.kind)}`);
  }
  if (data.version !== 2) {
    err('E2', `version が 2 ではない: ${JSON.stringify(data.version)}` +
      (data.version === 1 ? '（v1 のままなら node tools/migrate-phrases.mjs で変換する）' : ''));
  }
  if (!Array.isArray(data.phrases) || data.phrases.length === 0) {
    err('E3', 'phrases が非空の配列ではない');
    return { errors, warns, infos, report: null };
  }
  for (const k of ['langs', 'scenes', 'tags']) {
    const v = data[k];
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length === 0) {
      err('E4', `${k} が非空のオブジェクトではない`);
    }
  }
  const langs = (data.langs && typeof data.langs === 'object' && !Array.isArray(data.langs)) ? data.langs : {};
  const scenes = (data.scenes && typeof data.scenes === 'object' && !Array.isArray(data.scenes)) ? data.scenes : {};
  const tags = (data.tags && typeof data.tags === 'object' && !Array.isArray(data.tags)) ? data.tags : {};
  const langKeys = Object.keys(langs);

  // --- 5..10. langs ブロック ---
  let defaults = 0;
  for (const [L, c] of Object.entries(langs)) {
    if (!LANG_KEY.test(L)) err('E5', `langs のキーが言語コードの形式ではない: ${L}`);
    if (!c || typeof c !== 'object') { err('E6', `langs.${L} がオブジェクトではない`); continue; }
    if (typeof c.label !== 'string' || c.label === '') err('E6', `langs.${L}.label が非空文字列ではない`);
    if (typeof c.gradable !== 'boolean') err('E6', `langs.${L}.gradable が真偽値ではない`);
    if (typeof c.hasKana !== 'boolean') err('E6', `langs.${L}.hasKana が真偽値ではない`);
    if (c.status !== 'ready' && c.status !== 'draft') {
      err('E6', `langs.${L}.status が ready / draft ではない: ${JSON.stringify(c.status)}`);
    }
    if (c.default === true) {
      defaults += 1;
      if (c.gradable !== true) err('E7', `langs.${L} が default だが gradable ではない`);
      if (c.status !== 'ready') err('E7', `langs.${L} が default だが status が ready ではない`);
    }

    const sp = c.speech;
    if (!sp || typeof sp !== 'object') {
      err('E8', `langs.${L}.speech が無い`);
    } else {
      if (!Array.isArray(sp.prefer) || sp.prefer.length === 0) {
        err('E8', `langs.${L}.speech.prefer が非空配列ではない`);
      }
      if (!Array.isArray(sp.accept)) err('E8', `langs.${L}.speech.accept が配列ではない`);
      if (!(typeof sp.warn === 'string' || sp.warn === null)) {
        err('E8', `langs.${L}.speech.warn が文字列でも null でもない`);
      }
      if (Array.isArray(sp.prefer) && Array.isArray(sp.accept)) {
        const dup = sp.prefer.filter((x) => sp.accept.includes(x));
        if (dup.length) warn('W9', `langs.${L}.speech: prefer と accept の両方にある: ${dup.join(', ')}`);
      }
    }
    if (c.gradable === false && c.hasKana === true) {
      warn('W10', `langs.${L} は gradable ではないのに hasKana が true。表示専用の言語のカナは死に荷物`);
    }
  }
  if (langKeys.length > 0 && defaults !== 1) {
    err('E7', `default: true の言語がちょうど1つではない（${defaults}件）`);
  }

  // --- 11. scenes / tags の値 ---
  for (const [k, v] of Object.entries(scenes)) {
    if (typeof v !== 'string' || v === '') err('E11', `scenes.${k} が非空文字列ではない`);
  }
  for (const [k, v] of Object.entries(tags)) {
    if (typeof v !== 'string' || v === '') err('E11', `tags.${k} が非空文字列ではない`);
  }

  // --- フレーズごと ---
  const phrases = data.phrases;
  const at = (i, p) => `[${i}] ${p && p.id ? p.id : '(id不明)'}`;
  const seenId = new Map();
  const usedScenes = new Set();
  const usedTags = new Set();
  const textSeen = new Map();   // `${lang}\n${text}` -> id
  const jpSeen = new Map();
  let prevWeek = -Infinity;
  let weekDrop = 0;
  const fill = {};              // lang -> {text, kana}
  for (const L of langKeys) fill[L] = { text: 0, kana: 0 };
  // draft 言語の空欄は1件ずつ出すと数百行になる。まとめて数え、最後に1行で報告する
  const missing = {};           // `${L}.${field}` -> 件数

  phrases.forEach((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      err('E3', `[${i}] フレーズがオブジェクトではない`);
      return;
    }
    const where = at(i, p);

    // 13/14. id
    if (typeof p.id !== 'string' || !ID_RE.test(p.id)) {
      err('E13', `${where} id が /^[a-z0-9]+(-[a-z0-9]+)*$/ に一致しない`);
    } else if (seenId.has(p.id)) {
      err('E14', `${where} id が重複している（先に [${seenId.get(p.id)}] で使用）`);
    } else {
      seenId.set(p.id, i);
    }

    // 15. scene
    if (typeof p.scene !== 'string' || !(p.scene in scenes)) {
      err('E15', `${where} scene が scenes に無い: ${JSON.stringify(p.scene)}`);
    } else {
      usedScenes.add(p.scene);
    }

    // 16/17. week
    if (!Number.isInteger(p.week) || p.week <= 0) {
      err('E16', `${where} week が正の整数ではない: ${JSON.stringify(p.week)}`);
    } else {
      if (p.week < prevWeek) weekDrop += 1;
      prevWeek = p.week;
    }

    // 18. jp
    if (typeof p.jp !== 'string' || p.jp === '') {
      err('E18', `${where} jp が非空文字列ではない`);
    } else {
      if (jpSeen.has(p.jp)) warn('W34', `${where} jp が ${jpSeen.get(p.jp)} と重複: ${p.jp}`);
      else jpSeen.set(p.jp, p.id);
    }

    // 19. tags
    let tagList = [];
    if (!Array.isArray(p.tags) || p.tags.some((t) => typeof t !== 'string')) {
      err('E19', `${where} tags が文字列配列ではない`);
    } else {
      tagList = p.tags;
      if (new Set(tagList).size !== tagList.length) err('E19', `${where} tags に重複がある`);
      for (const t of tagList) {
        if (!(t in tags)) err('E19', `${where} 未宣言のタグ: ${t}`);
        else usedTags.add(t);
      }
    }
    const isFragment = tagList.includes('fragment');

    // 20. 旧形式のトップレベルフィールド
    const legacy = LEGACY_FIELDS.filter((f) => f in p);
    if (legacy.length) {
      err('E20', `${where} 旧形式のフィールドが残っている: ${legacy.join(', ')}（langs へ移す）`);
    }

    // 21. langs
    if (!p.langs || typeof p.langs !== 'object' || Array.isArray(p.langs)) {
      err('E21', `${where} langs が無い`);
      return;
    }
    for (const L of Object.keys(p.langs)) {
      if (!(L in langs)) err('E21', `${where} 未宣言の言語: ${L}`);
    }

    const qmark = new Map();  // gradable な言語の text.endsWith('?')
    for (const L of langKeys) {
      const cfg = langs[L] || {};
      const ready = cfg.status === 'ready';
      const sub = p.langs[L];
      // ready は1件ずつ ERROR にする（どのフレーズか知りたい）。
      // draft は集計だけして最後に1行にまとめる（未着手の言語は全件が空なので）
      const lack = (n, field, msg) => {
        if (ready) err(`E${n}`, msg);
        else missing[`${L}.${field}`] = (missing[`${L}.${field}`] || 0) + 1;
      };

      if (!sub || typeof sub !== 'object' || Array.isArray(sub)) {
        lack(22, 'text', `${where} langs.${L} が無い`);
        continue;
      }

      // 26. 未知のキー
      for (const k of Object.keys(sub)) {
        if (!LANG_FIELDS.has(k)) warn('W26', `${where} langs.${L} に未知のキー: ${k}`);
      }

      // 22/23. text
      const text = typeof sub.text === 'string' ? sub.text : '';
      if (typeof sub.text !== 'string' || sub.text.trim() === '') {
        lack(22, 'text', `${where} langs.${L}.text が空`);
      } else {
        fill[L].text += 1;

        // 27. 前後の空白・連続空白
        if (text !== text.trim()) err('E27', `${where} langs.${L}.text に前後の空白がある`);
        if (/ {2,}/.test(text)) err('E27', `${where} langs.${L}.text に連続空白がある`);
        // 28. 注記の混入
        if (/[（）]|※/.test(text)) {
          err('E28', `${where} langs.${L}.text に全角括弧か ※ がある。注記は note に置く: ${text}`);
        }
        // 29/30/31. fragment でない場合の体裁
        if (!isFragment) {
          if (!TERMINAL.test(text.trim())) warn('W29', `${where} langs.${L}.text が終止符で終わらない: ${text}`);
          if (!/^[\p{Lu}¿¡]/u.test(text)) warn('W30', `${where} langs.${L}.text が大文字で始まらない: ${text}`);
          if (text.includes('/')) warn('W31', `${where} langs.${L}.text に "/" がある（二択は1文に決める）: ${text}`);
        }
        // 33. 同一言語での本文重複
        const key = `${L}\n${text}`;
        if (textSeen.has(key)) warn('W33', `${where} langs.${L}.text が ${textSeen.get(key)} と重複: ${text}`);
        else textSeen.set(key, p.id);

        if (cfg.gradable) qmark.set(L, text.trim().endsWith('?'));
      }

      // 24/25. kana
      if (cfg.hasKana) {
        const kana = typeof sub.kana === 'string' ? sub.kana : '';
        if (kana.trim() === '') {
          lack(24, 'kana', `${where} langs.${L}.kana が空`);
        } else {
          fill[L].kana += 1;
          if (!KANA_RE.test(kana)) {
            err('E24', `${where} langs.${L}.kana にカタカナ以外の文字がある: ${kana}`);
          }
        }
      } else if ('kana' in sub) {
        err('E25', `${where} langs.${L} は hasKana ではないのに kana がある`);
      }

      // 28. note にも ※ の混入だけは見ない（note は注記そのもの）。型だけ確認
      if ('note' in sub && typeof sub.note !== 'string') {
        err('E22', `${where} langs.${L}.note が文字列ではない`);
      }
    }

    // 32. 言語間の疑問符の一致
    const marks = [...qmark.values()];
    if (marks.length > 1 && new Set(marks).size > 1) {
      const detail = [...qmark.entries()].map(([L, q]) => `${L}:${q ? '?' : '-'}`).join(' ');
      err('E32', `${where} 言語間で疑問符が一致しない（${detail}）`);
    }
  });

  // 23. draft 言語の空欄はここで1行にまとめる
  for (const [key, count] of Object.entries(missing)) {
    warn('W23', `langs.${key} が ${count}件 空（draft）。充足率は下の表を見る`);
  }

  // 12. 未使用の scene / tag
  for (const k of Object.keys(scenes)) {
    if (!usedScenes.has(k)) warn('W12', `scenes.${k} を使うフレーズが1件も無い`);
  }
  for (const k of Object.keys(tags)) {
    if (!usedTags.has(k)) warn('W12', `tags.${k} を使うフレーズが1件も無い`);
  }
  // 17. week の非減少
  if (weekDrop > 0) {
    warn('W17', `week が ${weekDrop}箇所で前より小さくなっている（末尾追記なら正常）`);
  }

  // 35/36. 容量
  const n = phrases.length;
  if (n > CAPACITY) {
    err('E35', `フレーズが ${n}件。スイープ期の網羅が保証できない（${SWEEP_DAYS}日 × ${SWEEP_CAP}枚 = ${CAPACITY}枚が上限）`);
  } else if (n > CAPACITY_WARN) {
    warn('W36', `フレーズが ${n}件。弱点カードの2〜3回目を配る余地が無くなる（上限 ${CAPACITY}枚）`);
  }

  // 38/39. audio-manifest との突き合わせ
  const mp3 = {};
  const manifestPath = new URL('../data/audio-manifest.json', import.meta.url);
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const byLang = Array.isArray(m) ? { pt: m } : (m && m.byLang) || {};
      if (Array.isArray(m)) warn('W38', 'data/audio-manifest.json が旧形式（平坦な配列）。byLang 形式に直す');
      for (const [L, ids] of Object.entries(byLang)) {
        if (!(L in langs)) { err('E38', `audio-manifest に未宣言の言語: ${L}`); continue; }
        const unknown = (ids || []).filter((id) => !seenId.has(id));
        if (unknown.length) {
          err('E38', `audio-manifest.${L} に phrases に無いid: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ' …' : ''}`);
        }
        mp3[L] = (ids || []).length;
      }
    } catch (e) {
      warn('W38', `data/audio-manifest.json を読めない: ${e.message}`);
    }
  }

  // 40. 並び変更の検出
  if (opts.git !== false && opts.path) {
    const drift = orderDrift(opts.path, phrases);
    if (drift > 0) {
      info('I40', `既存フレーズの並びが ${drift}件動いた。スイープ期間中は末尾への追記だけにする`);
    }
  }

  const report = {
    total: n,
    scenes: countBy(phrases, (p) => p.scene),
    weeks: countBy(phrases, (p) => p.week),
    fill,
    mp3,
    perSweepDay: Math.ceil(n / SWEEP_DAYS),
  };
  return { errors, warns, infos, report };
}

function countBy(list, key) {
  const out = {};
  for (const x of list) {
    const k = key(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/** git HEAD の同ファイルと id 列を比べ、位置が動いた既存idの数を返す。使えなければ 0 */
function orderDrift(path, phrases) {
  let head;
  try {
    const rel = path.replace(/^\.\//, '');
    head = execFileSync('git', ['show', `HEAD:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return 0;   // git 外、あるいは HEAD に無い。黙ってスキップ
  }
  let old;
  try {
    old = JSON.parse(head).phrases;
  } catch {
    return 0;
  }
  if (!Array.isArray(old)) return 0;

  const nowIdx = new Map(phrases.map((p, i) => [p.id, i]));
  let moved = 0;
  old.forEach((p, i) => {
    const j = nowIdx.get(p.id);
    if (j !== undefined && j !== i) moved += 1;
  });
  return moved;
}

// ---- 出力 ----

function printReport(r, langs) {
  const line = (k, v) => console.log(`  ${k.padEnd(14)} ${v}`);
  console.log('\nレポート');
  line('総数', `${r.total}件`);
  line('スイープ', `${r.perSweepDay}枚/日（${SWEEP_DAYS}日で1周、上限 ${SWEEP_CAP}枚/日）`);
  line('シーン別', Object.entries(r.scenes).map(([k, v]) => `${k}:${v}`).join(' '));
  line('週別', Object.entries(r.weeks).sort().map(([k, v]) => `${k}週:${v}`).join(' '));
  console.log('  言語別の充足率');
  for (const [L, f] of Object.entries(r.fill)) {
    const c = langs[L] || {};
    const kana = c.hasKana ? `, ${f.kana}/${r.total} kana` : '';
    const mp3 = r.mp3[L] !== undefined ? `, mp3 ${r.mp3[L]}/${r.total}` : '';
    console.log(`    ${L} [${c.status || '?'}] ${f.text}/${r.total} text${kana}${mp3}`);
  }
}

function report(res, langs) {
  for (const e of res.errors) console.error(`  ERROR ${e.code}  ${e.msg}`);
  for (const w of res.warns) console.warn(`  WARN  ${w.code}  ${w.msg}`);
  for (const i of res.infos) console.log(`  INFO  ${i.code}  ${i.msg}`);
  if (res.report) printReport(res.report, langs);
  console.log(`\nERROR ${res.errors.length}件 / WARN ${res.warns.length}件`);
}

// ---- 自己テスト ----

const okLangs = {
  pt: { label: 'ポルトガル語', labelShort: 'PT', gradable: true, hasKana: true, default: true, status: 'ready',
        speech: { prefer: ['pt-PT'], accept: ['pt-BR'], warn: 'x' } },
  en: { label: '英語', labelShort: 'EN', gradable: false, hasKana: false, status: 'draft',
        speech: { prefer: ['en-GB'], accept: [], warn: null } },
};
const okPhrase = () => ({
  id: 'greet-01', scene: 'greet', week: 1, jp: 'おはよう', tags: ['core'],
  langs: { pt: { text: 'Bom dia.', kana: 'ボン ディア', note: '' }, en: { text: 'Good morning.' } },
});
// 各テストが独立するよう必ず深いコピーを返す。参照を共有すると変更が後続テストへ漏れる
const base = (over = {}) => structuredClone({
  kind: 'phrases', version: 2, langs: okLangs,
  scenes: { greet: 'あいさつ' }, tags: { core: '中核', fragment: '断片' },
  phrases: [okPhrase()], ...over,
});

function selfTest() {
  let pass = 0, fail = 0;
  const t = (name, data, code, present = true) => {
    const res = validate(data, { git: false });
    const codes = [...res.errors, ...res.warns, ...res.infos].map((x) => x.code);
    const got = codes.includes(code);
    if (got === present) { pass += 1; console.log(`  ok   ${name}`); }
    else { fail += 1; console.error(`  FAIL ${name}: ${code} が ${present ? '出るはず' : '出ないはず'}。実際: ${codes.join(',') || 'なし'}`); }
  };
  const mut = (fn) => { const d = base(); fn(d); return d; };

  console.log('\n自己テスト');
  t('正常なファイルは ERROR なし', base(), 'E2', false);
  t('kind 違い', base({ kind: 'x' }), 'E2');
  t('version 違い', base({ version: 1 }), 'E2');
  t('phrases が空', base({ phrases: [] }), 'E3');
  t('langs が空', base({ langs: {} }), 'E4');
  t('言語コードの形式', mut((d) => { d.langs.XX = d.langs.en; }), 'E5');
  t('status が不正', mut((d) => { d.langs.pt.status = 'x'; }), 'E6');
  t('default が2つ', mut((d) => { d.langs.en.default = true; }), 'E7');
  t('default が draft', mut((d) => { d.langs.pt.status = 'draft'; }), 'E7');
  t('speech.prefer が空', mut((d) => { d.langs.pt.speech.prefer = []; }), 'E8');
  t('prefer と accept の重複', mut((d) => { d.langs.pt.speech.accept = ['pt-PT']; }), 'W9');
  t('表示専用なのに hasKana', mut((d) => { d.langs.en.hasKana = true; }), 'W10');
  t('未使用の scene', mut((d) => { d.scenes.extra = '未使用'; }), 'W12');
  t('id の形式', mut((d) => { d.phrases[0].id = 'Greet_01'; }), 'E13');
  t('id の重複', mut((d) => { d.phrases.push(okPhrase()); }), 'E14');
  t('未宣言の scene', mut((d) => { d.phrases[0].scene = 'nope'; }), 'E15');
  t('week が不正', mut((d) => { d.phrases[0].week = 0; }), 'E16');
  t('week の逆行', mut((d) => { const p = okPhrase(); p.id = 'g2'; p.week = 1; d.phrases[0].week = 3; d.phrases.push(p); }), 'W17');
  t('jp が空', mut((d) => { d.phrases[0].jp = ''; }), 'E18');
  t('未宣言のタグ', mut((d) => { d.phrases[0].tags = ['nope']; }), 'E19');
  t('旧形式のフィールド', mut((d) => { d.phrases[0].pt = 'Bom dia.'; }), 'E20');
  t('未宣言の言語', mut((d) => { d.phrases[0].langs.zz = { text: 'x' }; }), 'E21');
  t('ready で text が空', mut((d) => { d.phrases[0].langs.pt.text = ''; }), 'E22');
  t('draft で text が空は集計されて WARN', mut((d) => { d.phrases[0].langs.en.text = ''; }), 'W23');
  t('draft の空欄は1件ずつ ERROR にしない', mut((d) => { d.phrases[0].langs.en.text = ''; }), 'E22', false);
  t('kana が空', mut((d) => { d.phrases[0].langs.pt.kana = ''; }), 'E24');
  t('kana にカタカナ以外', mut((d) => { d.phrases[0].langs.pt.kana = 'bom dia'; }), 'E24');
  t('hasKana でない言語の kana', mut((d) => { d.phrases[0].langs.en.kana = 'グッド'; }), 'E25');
  t('未知のキー', mut((d) => { d.phrases[0].langs.pt.extra = 1; }), 'W26');
  t('前後の空白', mut((d) => { d.phrases[0].langs.pt.text = ' Bom dia. '; }), 'E27');
  t('連続空白', mut((d) => { d.phrases[0].langs.pt.text = 'Bom  dia.'; }), 'E27');
  t('本文に全角括弧', mut((d) => { d.phrases[0].langs.pt.text = 'Bom dia.（朝）'; }), 'E28');
  t('終止符なし', mut((d) => { d.phrases[0].langs.pt.text = 'Bom dia'; }), 'W29');
  t('fragment なら終止符不要', mut((d) => { d.phrases[0].tags = ['fragment']; d.phrases[0].langs.pt.text = 'zero'; d.phrases[0].langs.en.text = 'zero'; }), 'W29', false);
  t('小文字始まり', mut((d) => { d.phrases[0].langs.pt.text = 'bom dia.'; }), 'W30');
  t('本文に "/"', mut((d) => { d.phrases[0].langs.pt.text = 'Bom dia. / Boa tarde.'; }), 'W31');
  t('疑問符の不一致', mut((d) => {
    d.langs.en.gradable = true;
    d.phrases[0].langs.pt.text = 'Fala inglês?';
    d.phrases[0].langs.en.text = 'You speak English.';
  }), 'E32');
  t('同一言語の本文重複', mut((d) => { const p = okPhrase(); p.id = 'g2'; p.jp = '別'; d.phrases.push(p); }), 'W33');
  t('jp の重複', mut((d) => { const p = okPhrase(); p.id = 'g2'; p.langs.pt.text = 'Olá.'; p.langs.en.text = 'Hi.'; d.phrases.push(p); }), 'W34');
  t('容量の上限', mut((d) => {
    d.phrases = Array.from({ length: CAPACITY + 1 }, (_, i) => {
      const p = okPhrase(); p.id = `x-${i}`; p.jp = `j${i}`;
      p.langs.pt.text = `T${i}.`; p.langs.en.text = `E${i}.`; return p;
    });
  }), 'E35');
  t('容量の警告', mut((d) => {
    d.phrases = Array.from({ length: CAPACITY_WARN + 1 }, (_, i) => {
      const p = okPhrase(); p.id = `x-${i}`; p.jp = `j${i}`;
      p.langs.pt.text = `T${i}.`; p.langs.en.text = `E${i}.`; return p;
    });
  }), 'W36');

  console.log(`\n${pass} 件成功${fail ? `、${fail} 件失敗` : ''}`);
  return fail === 0;
}

// ---- エントリポイント ----

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    process.exitCode = selfTest() ? 0 : 1;
    return;
  }

  const rel = args.find((a) => !a.startsWith('-')) || 'data/phrases.json';
  let raw;
  try {
    raw = readFileSync(rel, 'utf8');
  } catch (e) {
    console.error(`読み込めない: ${rel}\n  ${e.message}`);
    process.exitCode = 1;
    return;
  }

  let data;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (e) {
    console.error(`  ERROR E1  JSON として読めない: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`検証: ${rel}`);
  const res = validate(data, { raw, path: rel });
  report(res, (data && data.langs) || {});
  process.exitCode = res.errors.length > 0 ? 1 : 0;
}

main();
