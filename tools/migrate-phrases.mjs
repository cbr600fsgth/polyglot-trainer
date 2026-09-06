// data/phrases.json (v1) → data/phrases.v2.json (v2) への一度きりの変換。
// node tools/migrate-phrases.mjs で実行する。
//
// data/phrases.json は上書きしない。生成物はレビュー前提で、es/it/en の未入力欄は
// 空文字で出力し、人手が要る箇所を標準出力に並べる。本体への昇格は git mv で人間が行う。
// こうすると何度でも再実行でき、中途半端に適用された状態が生まれない。
//
// 詳細は docs/SPEC-multilingual.md の 3.5 / 3.6。Node標準機能のみ。依存ゼロ。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SRC = new URL('../data/phrases.json', import.meta.url);
const OUT = new URL('../data/phrases.v2.json', import.meta.url);

// 文ではない断片（数詞・時刻・曜日）。終止符なし・小文字始まり・"/" を許す。
// 実データで「終止符が無く小文字で始まる」16件と一致することを確認済み。
const FRAGMENT = new Set([
  'numero-01', 'numero-02', 'numero-03', 'numero-04', 'numero-05', 'numero-06', 'numero-07',
  'num2-01', 'num2-02', 'num2-03', 'num2-04', 'num2-09', 'num2-10', 'num2-11', 'num2-12', 'num2-13',
]);

// 言語カタログ。pt だけが完成しているので ready、残りは中身が埋まるまで draft。
// draft の言語はアプリの主言語の選択肢に出ず、check-phrases も空欄を WARN 止まりにする。
const LANGS = {
  pt: {
    label: 'ポルトガル語', labelShort: 'PT',
    gradable: true, hasKana: true, default: true, status: 'ready',
    speech: {
      prefer: ['pt-PT'],
      accept: ['pt-BR', 'pt'],
      warn: 'この端末にヨーロッパポルトガル語の音声がありません。ブラジル音声で代用中のため発音が実際と異なります。設定 → 音声 から確認してください。',
    },
  },
  es: {
    label: 'スペイン語', labelShort: 'ES',
    gradable: true, hasKana: true, status: 'draft',
    speech: {
      prefer: ['es-ES'],
      accept: ['es-419', 'es-MX', 'es-US', 'es'],
      warn: 'この端末にスペイン（イベリア）の音声がありません。中南米音声で代用中のため ci / ce / z の発音が実際と異なります。設定 → 音声 から確認してください。',
    },
  },
  it: {
    label: 'イタリア語', labelShort: 'IT',
    gradable: true, hasKana: true, status: 'draft',
    speech: { prefer: ['it-IT'], accept: ['it'], warn: null },
  },
  en: {
    label: '英語', labelShort: 'EN',
    gradable: false, hasKana: false, status: 'draft',
    speech: { prefer: ['en-GB'], accept: ['en-US', 'en-AU', 'en'], warn: null },
  },
};

const SCENES = {
  greet: 'あいさつ', basic: '基本', numero: '数字・時刻',
  pedir: '頼む・尋ねる', restaurante: 'レストラン', cafe: 'カフェ',
  transporte: '移動', hotel: '宿', compras: '買い物・チケット',
  problema: '困ったとき',
};

const TAGS = {
  core: '旅行必須の中核',
  must: '暗記必須',
  ptpt: 'pt-PT固有の語形（ブラジル語形と異なる）',
  frame: '他の語を差し替えて使える型',
  fragment: '文ではない断片（数詞・時刻・曜日）。終止符なし・小文字始まりを許す',
};

const NOTE = '配列の順序が学習カリキュラムの投入順を決める。スイープ期間中は末尾への追記のみ許される。';

// ---- 変換 ----

if (existsSync(OUT)) {
  console.error('data/phrases.v2.json が既にある。消してから実行する');
  process.exit(1);
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));
if (src.version !== 1) {
  console.error(`version 1 ではない: ${JSON.stringify(src.version)}`);
  process.exit(1);
}

const todo = { paren: [], punct: [], fragment: [], slash: [], itKana: [], esAll: [], enAll: [] };

const phrases = src.phrases.map((p) => {
  // it: 末尾の括弧注記を note へ剥がす
  let itText = p.it.trim();
  let itNote = '';
  const m = itText.match(/[（(]([^）)]*)[）)]\s*$/);
  if (m) {
    itNote = m[1];
    itText = itText.slice(0, m.index).trim();
    todo.paren.push(p.id);
  }

  // it: 終止符を pt から復元。fragment は文ではないので対象外
  const isFragment = FRAGMENT.has(p.id);
  const ptEnd = (p.pt.trim().match(/[.?!]$/) || [])[0];
  if (ptEnd && !/[.?!]$/.test(itText) && !isFragment) {
    itText += ptEnd;
    todo.punct.push(p.id);
  }

  if (isFragment) todo.fragment.push(p.id);
  // fragment 以外に残る "/" は人が1文に決める必要がある
  if (itText.includes('/') && !isFragment) todo.slash.push(`${p.id}: ${itText}`);

  todo.itKana.push(p.id);
  todo.esAll.push(p.id);
  todo.enAll.push(p.id);

  return {
    id: p.id,
    scene: p.scene,
    week: p.week,
    jp: p.jp,
    tags: isFragment ? [...p.tags, 'fragment'] : [...p.tags],
    langs: {
      pt: { text: p.pt, kana: p.kana, note: p.note },   // 完全に無改変
      es: { text: '', kana: '', note: '' },
      it: { text: itText, kana: '', note: itNote },
      en: { text: '' },
    },
  };
});

const out = {
  kind: 'phrases',
  version: 2,
  note: NOTE,
  langs: LANGS,
  scenes: SCENES,
  tags: TAGS,
  phrases,
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

// ---- レポート ----

const n = phrases.length;
console.log(`変換 ${n}件 → data/phrases.v2.json`);
console.log(`  it 終止符を補った          ${String(todo.punct.length).padStart(3)}件`);
console.log(`  it 括弧注記を noteへ移した  ${String(todo.paren.length).padStart(3)}件  (${todo.paren.join(', ') || 'なし'})`);
console.log(`  fragment タグを付けた       ${String(todo.fragment.length).padStart(3)}件`);

console.log('\n人手が必要');
console.log(`  [要判断] it に "/" が残る    ${String(todo.slash.length).padStart(3)}件`);
for (const s of todo.slash) console.log(`     ${s}`);
console.log(`  [要入力] it kana           ${String(todo.itKana.length).padStart(3)}件（全件）`);
console.log(`  [要入力] es text/kana/note ${String(todo.esAll.length).padStart(3)}件（全件）`);
console.log(`  [要入力] en text           ${String(todo.enAll.length).padStart(3)}件（全件）`);

console.log('\n言語の状態');
for (const [L, c] of Object.entries(LANGS)) {
  console.log(`  ${L} [${c.status}]${c.status === 'draft' ? '  中身が揃ったら ready に変える' : '  完成'}`);
}

console.log(`
次の手順
  1. data/phrases.v2.json を編集して上の TODO を埋める（シーン単位で刻むとレビューしやすい）
  2. node tools/check-phrases.mjs data/phrases.v2.json
  3. 全件 ERROR ゼロになったら es/it/en の status を ready にする
  4. git mv data/phrases.v2.json data/phrases.json`);
