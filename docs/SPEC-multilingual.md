# 多言語対応 拡張仕様書

ポルトガル語トレーナーをフォークし、**ポルトガル語・スペイン語・イタリア語**に対応させるための仕様。
本書は実装前の設計書であり、この時点ではアプリのコードは変更していない。

対象リポジトリ: `cbr600fsgth/portuguese-trainer`（フォーク元）
前提知識: `README.md` を読んでいること。本書は差分だけを書く。

---

## 1. 概要と設計方針

### 1.1 何を変えるのか

現行アプリはヨーロッパポルトガル語（pt-PT）専用で、150フレーズを出発日から逆算した
2段SRSで回す。これを次のように広げる。

- 学習できる言語を **ポルトガル語 / スペイン語 / イタリア語** の3つにする
- 解答画面で、同じ意味の文を **4言語（pt / es / it / en）同時に**並べて比較できるようにする
- 採点に **「必要なし」** を追加し、押したフレーズをその言語の学習対象から外せるようにする
- 管理者（リポジトリを編集する人）が、**学習中でもフレーズを追加・削除**できるようにする

### 1.2 いちばん大事な前提

**利用者は、旅行の前にその国の言語ひとつをマスターする。3言語を毎日並行して学習しない。**

この前提から次が導かれる。

- 採点の対象は常に**1言語だけ**（以下「主言語」と呼ぶ）。残りの2言語と英語は解答面に
  並ぶだけで、採点も進捗もない（以下「参照言語」）
- 1日の出題上限は**現行のまま**でよい。`NEW_PER_DAY = 5` / `REVIEW_CAP = 30` /
  `SWEEP_CAP = 25` を変えないので、「150枚を45日で仕上げる」計画と `tools/test-srs.mjs` の
  45日シミュレーションがそのまま生き続ける
- ただし進捗は**フレーズ×言語**で別々に保存する。来年べつの言語に切り替えても、
  去年やった言語の箱・ラプス・出発日がそのまま残っていて、いつでも戻れる

「全言語まとめて1枚のカードにして1回だけ採点する」案は採らなかった。
「イタリア語は言えたがスペイン語は無理」を区別できず、得意な言語に引きずられて
苦手な言語が定着しないため。画面の見た目（日本語 → 全言語表示）は同じで、
違うのは「採点が主言語だけに効く」という点だけである。

### 1.3 決定事項の一覧

| # | 論点 | 決定 |
|---|---|---|
| 1 | 学習の単位 | 主言語＋比較表示。採点は主言語のみ。進捗はフレーズ×言語で別保存 |
| 2 | 1日の負荷 | 1言語ずつマスターする前提。上限は現状維持 |
| 3 | 「必要なし」 | 学習中の言語だけ除外。進捗カードに `suspended` フラグ。設定から手動復活 |
| 4 | カナ表記 | pt / es / it すべてに用意（英語はなし） |
| 5 | 出発日 | 言語ごとに保持 |
| 6 | データ構成 | 1ファイルに `langs` で集約（`data/phrases.json` v2） |
| 7 | 進捗の移行 | 起動時に自動移行。旧キー `pt.*` は削除せず残す |
| 8 | 英語 | 参照表示専用（採点なし・進捗なし・音声あり・カナなし） |
| 9 | 音声ロケール | pt-PT / es-ES / it-IT / en-GB。警告は主言語のみ |

### 1.4 変えないもの

- フレームワークなし・ビルドなし・依存ゼロ・`package.json` を持たない構成
- SRSの2段構成（学習期の箱方式 → 出発10日前からの最終スイープ）とその定数
- 「その日の最悪の採点が勝つ」採点セマンティクス
- UI の表示言語は日本語のまま（学習**対象**が可変になるだけで、画面の日本語は多言語化しない）
- `js/srs.js` が純関数だけで実日付を持たないこと

---

## 2. 用語

| 用語 | 意味 |
|---|---|
| **フレーズ** | `data/phrases.json` の1エントリ。日本語1文と、それに対応する4言語の文を束ねたもの |
| **主言語** | いま採点対象になっている言語。`pt` / `es` / `it` のいずれか1つ |
| **参照言語** | 解答面に並ぶだけで採点されない言語。主言語以外の2言語と `en` |
| **カード** | 「フレーズ×言語」1組ぶんの学習進捗。箱・ラプス・次回出題日を持つ |
| **除外** | 「必要なし」を押した状態。そのカードだけが出題対象から外れる |
| **孤立カード** | `data/phrases.json` から消えたフレーズのカード。記録は残すが出題しない |

---

## 3. データ仕様

### 3.1 `data/phrases.json` v2

envelope に言語カタログ・シーン名・タグ辞書を持たせ、フレーズ側は `langs` で言語を束ねる。

```jsonc
{
  "kind": "phrases",   // 書き出しJSONと取り違えないための識別子
  "version": 2,        // このファイルの構造版。書き出しJSONの version 3 とは別系列
  "note": "配列の順序が学習カリキュラムの投入順を決める。スイープ期間中は末尾への追記のみ許される。",

  "langs": {
    "pt": {
      "label": "ポルトガル語", "labelShort": "PT",
      "gradable": true,      // 採点・進捗の対象になるか
      "hasKana": true,       // kana を必須にするか
      "default": true,       // 主言語の初期値。gradable な言語のうち1つだけ true
      "status": "ready",     // "ready" | "draft"。draft は主言語の選択肢に出さない
      "speech": {
        "prefer": ["pt-PT"],
        "accept": ["pt-BR", "pt"],
        "warn": "この端末にヨーロッパポルトガル語の音声がありません。ブラジル音声で代用中のため発音が実際と異なります。設定 → 音声 から確認してください。"
      }
    },
    "es": {
      "label": "スペイン語", "labelShort": "ES",
      "gradable": true, "hasKana": true, "status": "draft",
      "speech": {
        "prefer": ["es-ES"],
        "accept": ["es-419", "es-MX", "es-US", "es"],
        "warn": "この端末にスペイン（イベリア）の音声がありません。中南米音声で代用中のため ci / ce / z の発音が実際と異なります。設定 → 音声 から確認してください。"
      }
    },
    "it": {
      "label": "イタリア語", "labelShort": "IT",
      "gradable": true, "hasKana": true, "status": "draft",
      "speech": { "prefer": ["it-IT"], "accept": ["it"], "warn": null }
    },
    "en": {
      "label": "英語", "labelShort": "EN",
      "gradable": false, "hasKana": false, "status": "ready",
      "speech": { "prefer": ["en-GB"], "accept": ["en-US", "en-AU", "en"], "warn": null }
    }
  },

  "scenes": {
    "greet": "あいさつ", "basic": "基本", "numero": "数字・時刻",
    "pedir": "頼む・尋ねる", "restaurante": "レストラン", "cafe": "カフェ",
    "transporte": "移動", "hotel": "宿", "compras": "買い物・チケット",
    "problema": "困ったとき"
  },

  "tags": {
    "core": "旅行必須の中核",
    "must": "暗記必須",
    "ptpt": "pt-PT固有の語形（ブラジル語形と異なる）",
    "frame": "他の語を差し替えて使える型",
    "fragment": "文ではない断片（数詞・時刻・曜日）。終止符なし・小文字始まりを許す"
  },

  "phrases": [ /* ... */ ]
}
```

`speech.warn` を `null` にすることが「この言語では地域差の警告を出さない」の意味になる。
現行の `js/audio.js:87-102` はこの判定を `ptpt` / `ptbr` という文字列定数でハードコード
しているが、v2 ではデータの参照に置き換わる。**言語を1つ足す作業がデータ編集だけで済む**のが
この構造の狙いである。

### 3.2 フレーズ1件の形

```jsonc
{
  "id":    "greet-01",        // 恒久。一度使ったIDは絶対に再利用しない（→ 10章 R2）
  "scene": "greet",           // envelope.scenes のキー
  "week":  1,                 // 配列内で非減少（末尾追記時のみ例外を許す）
  "jp":    "おはようございます",
  "tags":  ["core", "must"],  // envelope.tags のキーのみ
  "langs": {
    "pt": { "text": "...", "kana": "...", "note": "..." },
    "es": { "text": "...", "kana": "...", "note": "..." },
    "it": { "text": "...", "kana": "...", "note": "..." },
    "en": { "text": "..." }
  }
}
```

- `text` — 実際に発話し、画面に出す文そのもの。**注記や括弧書きを入れない**
- `kana` — `hasKana: true` の言語で必須。`en` では禁止
- `note` — 任意。**言語ごとに別**。ptのメモをes/itと共有しない

### 3.3 記述例

`greet-01`（素直な例）:

```json
{
  "id": "greet-01",
  "scene": "greet",
  "week": 1,
  "jp": "おはようございます",
  "tags": ["core", "must"],
  "langs": {
    "pt": { "text": "Bom dia.",     "kana": "ボン ディア",       "note": "朝から正午まで。店に入ったら必ずこれを先に言う" },
    "es": { "text": "Buenos días.", "kana": "ブエノス ディアス", "note": "複数形。単数のBuen díaは中南米の一部だけ" },
    "it": { "text": "Buongiorno.",  "kana": "ブオンジョルノ",    "note": "正午を過ぎるとBuonaseraに切り替わる" },
    "en": { "text": "Good morning." }
  }
}
```

`greet-05`（既存データで唯一、注記が本文に混ざっている例）:

現行の `"it": "Grazie（同源ではない）"` は、括弧の中身を **`langs.it.note` に移す**。
本文に注記を残すと TTS が読み上げてしまい、利用者は何を言えばいいか分からない。

```json
{
  "id": "greet-05",
  "scene": "greet",
  "week": 1,
  "jp": "ありがとう",
  "tags": ["core", "must"],
  "langs": {
    "pt": { "text": "Obrigado.", "kana": "オブリガードゥ", "note": "話し手が男性ならObrigado固定。女性店員からはObrigadaと返ってくる" },
    "es": { "text": "Gracias.",  "kana": "グラシアス",     "note": "性変化しない。ptのObrigado/Obrigadaと違い話し手の性別を問わない" },
    "it": { "text": "Grazie.",   "kana": "グラーツィエ",   "note": "ptのObrigadoとは同源ではない。語形から推測できないので個別に覚える" },
    "en": { "text": "Thank you." }
  }
}
```

### 3.4 シーン名とタグ辞書をデータ側へ移す

現行の `SCENE_LABELS`（`js/app.js:8-19`）を `envelope.scenes` に移す。理由は3つ。

1. `tools/check-phrases.mjs` が「すべての `scene` に日本語名があるか」を検証できるようになる。
   JS側に置いたままだと、検証ツールが JavaScript を解析するかモジュールを import するはめになる
2. `README.md` の「追加する場合は `js/app.js` の `SCENE_LABELS` にも日本語名を足す」という
   **2ファイル同時編集の指示が消える**。この指示は忘れられやすく、しかも失敗が静かである
   （`SCENE_LABELS[p.scene] || p.scene` が生のスラッグにフォールバックするだけ）
3. このアプリは日本語専用で i18n 層を持たないため、「UI文言はコード側に置く」という
   反対理由が成り立たない

`js/app.js` 側のフォールバック（`scenes[p.scene] || p.scene`）は残す。
タグ辞書も同じ理由で `envelope.tags` に置き、検証ツールがタグのtypoを弾けるようにする
（現行の `tags` は一切検証されていない）。

### 3.5 既存150件の移行方針

**重要な事実**: 既存の `it` フィールドは、README が「イタリア語ブリッジ」と説明しているものの、
実データを全件走査すると **150件中149件が正規のイタリア語訳**である。注記付きは `greet-05` の
1件のみ。疑問符の一致は150/150（不一致ゼロ）。つまり**イタリア語は本文をほぼ流用できる**。

| 旧フィールド | 移行先 | 機械的にできるか |
|---|---|---|
| `id` / `scene` / `week` / `jp` / `tags` | そのままトップレベル | できる |
| `pt` | `langs.pt.text` | できる（無改変） |
| `kana` | `langs.pt.kana` | できる（無改変） |
| `note` | **`langs.pt.note`**（pt固有。共有しない） | できる（無改変） |
| `it` | `langs.it.text`（正規化後） | ほぼできる。下記3点の処理が要る |
| — | `langs.it.kana` | **できない。150件を新規に用意する** |
| — | `langs.it.note` | できない。任意。空で開始してよい |
| — | `langs.es.*` | **できない。150件×(text, kana, note) を新規に用意する** |
| — | `langs.en.text` | **できない。150件を新規に用意する** |

`it` に対して機械的にかける処理は次の3つ。

1. **括弧注記を `note` へ剥がす** — 該当1件（`greet-05`）
2. **終止符を pt 側から復元する** — `pt.text` が `.` `?` `!` で終わり、`it` が終止符を
   持たないとき、同じ文字を足す。該当78件（すべて `.`）。`?` 54件と `!` 2件は既に一致している
3. **`fragment` タグを付ける** — 終止符を持たず小文字で始まる16件（`numero-01`〜`07`,
   `num2-01,02,03,04,09,10,11,12,13`）。数詞・時刻・曜日の断片で、文ではない

そのうえで**人手の判断が要るもの**が残る。

- **`/` による二択表記が6件**。`greet-03` `Buonasera / Buonanotte`、`numero-07` `zero / mezzo`、
  `pedir-05` `Ha...? / C'è...?`、`num2-11` / `num2-12` / `num2-13`。
  ブリッジ注釈なら二択で十分だったが、**採点され読み上げられる学習対象としては成立しない**
  （TTSがスラッシュを読む。利用者はどちらを言えばいいか分からない）。
  `fragment` でない `greet-03` と `pedir-05` は1文に決めるか、末尾に新IDで分割する。
  `fragment` の4件は残してよく、`js/audio.js` が読み上げ前に `/\s+\/\s+/g → ', '` に正規化する
- **`greet-03` の日本語が `こんばんは / おやすみなさい`** で、1つのptフレーズが2つのイタリア語に
  対応している。分割するかどうかは人の判断
- **敬体の一貫性**。pt は você（3人称）の丁寧形で統一されている（`Fala inglês?`, `Chame a polícia`）。
  it も Lei で揃っているが、記憶の手がかりではなく採点対象になる以上、目視で確認する

### 3.6 `tools/migrate-phrases.mjs`

一度きりの変換ツール。Node標準機能のみ、依存ゼロ。

**`data/phrases.json` を上書きしない。** `data/phrases.v2.json` を書き出し、レポートを標準出力に
出すだけにする。本体への昇格は人間による `git mv` とする。こうすると何度でも再実行でき、
中途半端に適用された状態が生まれない。

処理の骨子:

```js
const src = JSON.parse(readFileSync(SRC, 'utf8'));
if (src.version !== 1) { console.error(`version 1 ではない: ${src.version}`); process.exit(1); }

const phrases = src.phrases.map((p) => {
  // it: 括弧注記を note へ剥がす
  let itText = p.it.trim(), itNote = '';
  const m = itText.match(/[（(]([^）)]*)[）)]\s*$/);
  if (m) { itNote = m[1]; itText = itText.slice(0, m.index).trim(); }

  // it: 終止符を pt から復元（fragment は対象外）
  const ptEnd = (p.pt.trim().match(/[.?!]$/) || [])[0];
  if (ptEnd && !/[.?!]$/.test(itText) && !FRAGMENT.has(p.id)) itText += ptEnd;

  return {
    id: p.id, scene: p.scene, week: p.week, jp: p.jp,
    tags: FRAGMENT.has(p.id) ? [...p.tags, 'fragment'] : [...p.tags],
    langs: {
      pt: { text: p.pt, kana: p.kana, note: p.note },  // 完全に無改変
      es: { text: '', kana: '', note: '' },
      it: { text: itText, kana: '', note: itNote },
      en: { text: '' },
    },
  };
});
```

標準出力のレポート:

```
変換 150件
  it 終止符を補った         78件
  it 括弧注記を noteへ移した  1件  (greet-05)
  fragment タグを付けた      16件
人手が必要
  [要判断] it に "/" が残る   6件
     greet-03: Buonasera / Buonanotte
     pedir-05: Ha...? / C'è...?
     ...
  [要入力] it kana         150件（全件）
  [要入力] es text/kana/note 150件（全件）
  [要入力] en text          150件（全件）
次の手順
  1. data/phrases.v2.json を編集して上の TODO を埋める
  2. node tools/check-phrases.mjs data/phrases.v2.json
  3. git mv data/phrases.v2.json data/phrases.json
```

### 3.7 `status: "draft"` による段階リリース

`langs[L].status` を `"draft"` にしておくと、その言語は次のように扱われる。

- 主言語の選択肢に出ない（設定画面のスイッチャーに現れない）
- 解答面の参照行にも出ない
- `check-phrases.mjs` は本文の空欄を**エラーではなく警告**として報告する

これにより「構造の変更だけ先に入れて、pt と it は動く。es は空のまま」という状態で
安全にリリースできる。150件が埋まったら `"ready"` に変える1語のコミットで有効化され、
以後は空欄がすべてエラーになる。

### 3.8 フレーズの追加・削除

進捗は `{言語}:{フレーズid}` で引くので、フレーズの増減は原理的に進捗を壊さない。
守るべき不変条件は次の3つ。

1. **id は恒久。一度使ったidを別の意味で再利用しない。**
   再利用すると、消したフレーズの箱・ラプス・`suspended` を新しいフレーズが継承する。
   とくに `suspended: true` を継承した場合、利用者が一度も見ていないフレーズが
   永久に出題されなくなり、しかも画面のどこにも異常が出ない（→ 10章 R2）
2. **削除しても進捗を消さない。** 出題からは外れるが記録は残る。フレーズを戻せば進捗も戻る
3. **最終スイープの期間中は、配列の末尾への追記だけにする。**
   途中挿入・削除・並べ替えはスイープの網羅保証を壊す（→ 5.4 で詳述）。
   実装側でも `trip.sweepOrder` による凍結で守るが、編集規約としても明記する

追加の手順は現行と同じく `phrases` 配列に足すだけだが、`scenes` / `tags` に無いキーを
使った場合は `check-phrases.mjs` がエラーにする。

---

## 4. 進捗データ仕様

### 4.1 カード v2

```jsonc
{
  "id": "greet-01",
  "box": 2,                    // 1..5
  "lapses": 0,
  "due": "2030-04-13",
  "firstSeen": "2030-04-10",
  "lastSeen": "2030-04-11",
  "gradedOn": "2030-04-11",
  "dayWorst": "good",
  "preBox": 1,

  // --- v2 で追加。3つとも「キーが無い＝有効なカード」を意味する ---
  "suspended": true,            // 「必要なし」
  "suspendedOn": "2030-04-20",  // 除外した日。除外リストの並び順に使う
  "unsuspendedOn": "2030-05-12" // 直近の復活日。スイープ中の再浮上に使う
}
```

**`"suspended": false` を書いてはいけない。** 有効に戻すときはキーごと `delete` する。
こうすると移行前の既存カードに何も足さなくてよく、`if (c.suspended)` という素朴な判定が
古いデータに対しても正しく動く。

### 4.2 「必要なし」の正確なルール

**新規カードで「必要なし」を押した場合は、`introduce()` してから `suspend()` する。**
除外専用のレジストリは作らない。

```js
/** 「必要なし」。主言語のカードだけを止める。箱もlapsesも消さない */
export function suspend(card, today) {
  const next = { ...card, suspended: true, suspendedOn: today };
  delete next.unsuspendedOn;
  return next;
}

/** 未投入のフレーズを、投入と同時に除外する */
export function suspendNew(id, today) {
  return suspend(introduce(id, today), today);
}

/**
 * 除外を解除する。
 *  - 一度でも採点したカード: 箱・lapses をそのまま復帰させ、当日から復習に出す
 *  - 一度も採点していないカード: 新規として投入し直す（当日の新規枠を1つ使う）
 */
export function unsuspend(card, today) {
  const fresh = !card.gradedOn;
  const base = fresh ? introduce(card.id, today) : { ...card, due: today };
  const next = { ...base, unsuspendedOn: today };
  delete next.suspended;
  delete next.suspendedOn;
  return next;
}
```

除外専用レジストリ（`poly.suspended[lang] = [id...]`）にしなかった理由:

- カードマップとレジストリの**2箇所を同期し続ける**必要が出る。復習リスト・新規リスト・
  スイープ・定着分母の4箇所すべてで両方を見る必要があり、1箇所忘れると静かに壊れる
- カードマップは既に「書き出し・読み込み・リセット・移行」の対象になっている。相乗りは無料
- 「復活したらカードが元の位置に戻る」が自動的に成り立つ

このルールから導かれる挙動（すべて意図したもの。テストで固定する）:

1. **新規カードを除外すると、その日の新規枠を1つ消費する。** `buildSession` は
   `firstSeen === today` を**生のマップ**で数えるため（`js/srs.js:262`）、5回「必要なし」を
   押せばその日の新規は打ち止めになる。日次上限はセッション時間を10分に抑えるために
   あるので、これが正しい。「必要なし」を連打してカードを掘り進める抜け道も塞がる
2. **除外したカードが新規として再提示されることはない。** `!cards[p.id]`（`js/srs.js:266`）は
   生のマップを見るので、レコードが存在する時点で新規候補から外れる
3. **未採点カードを復活させると新規として投入し直される。** `firstSeen` が復活日になるので、
   その日は昇格できない（`canPromote`、`js/srs.js:106`）。10枚まとめて復活させると
   その日の新規枠がゼロになる。自己抑制的であり、README に書く
4. **同日に採点してから除外しても壊れない。** `gradedOn` / `dayWorst` は残るので、
   同じ日に復活させて採点し直しても「最悪の採点が勝つ」経路が正しく働く

**「必要なし」は採点ではない。** `SEVERITY`（`js/srs.js:84`）に足さず、`nextState()` に渡さない。
UIのボタンは `suspend()` / `suspendNew()` を直接呼ぶ。

### 4.3 localStorage の設計

```js
const K = {
  progress: 'poly.progress',   // { [lang]: { [id]: card } }
  trips:    'poly.trips',      // { [lang]: { departure, sweepOrder? } }
  meta:     'poly.meta',       // 言語横断で1つ
  settings: 'poly.settings',   // { primary, showLangs }
};
const LEGACY = { cards: 'pt.cards', meta: 'pt.meta', trip: 'pt.trip' };
const LEGACY_LANG = 'pt';
```

キー名を変える理由は、GitHub Pages で公開したときに `ユーザー名.github.io` が
**リポジトリをまたいで同一オリジン**になるためである。キー名が同じだとフォーク元アプリと
進捗を奪い合う。

`DEFAULT_META` から `modeOverride` を落とす。宣言されているだけでどこからも読まれていない
死にフィールドである（現行 `js/store.js:13`）。

**ストリークは言語横断で1本にする。** 主言語を切り替えても連続日数はリセットしない。
「今日も学習した」という事実は言語に依存しないうえ、切替のたびにゼロに戻るのは
続ける動機を削ぐだけである。

### 4.4 `js/store.js` v2 の API

```js
export const KEYS = K;                                 // 設定画面の診断表示用

// --- 進捗 ---
export function loadAllProgress()                      // -> { [lang]: {[id]:card} }
export function loadProgress(lang)                     // -> {[id]:card}（無ければ {}）
export function saveProgress(lang, cards)              // -> boolean
export function saveCard(lang, card)                   // -> boolean。採点1枚ぶんの高速経路
export function languagesWithProgress()                // -> string[]

// --- 旅程（言語ごと） ---
export function loadTrips()                            // -> { [lang]: trip }
export function loadTrip(lang)                         // -> {departure, sweepOrder?} | null
export function saveTrip(lang, trip)                   // -> boolean。既存の sweepOrder は保つ
export function loadSweepOrder(lang) / saveSweepOrder(lang, ids) / clearSweepOrder(lang)

// --- メタ（言語横断） ---
export function loadMeta() / saveMeta(meta)
export function recordSession(meta, today, yesterday)  // 現行のまま

// --- 設定 ---
export function loadSettings() / saveSettings(s) / setPrimary(lang)

// --- 入出力 ---
export function exportJSON()                           // -> string（version 3）
export function importJSON(text)                       // v2 / v3 両対応
export function migrateLegacy(opts)                    // -> {migrated, reason, count}
export function legacyPresent()                        // -> boolean

// --- 消去 ---
export function resetProgress(lang) / resetMeta() / resetAll()
```

**`js/store.js` は言語コードを `LEGACY_LANG` 以外ひとつも知らない。**
`loadProgress(lang)` は任意の文字列で動く。言語カタログは `data/phrases.json` にあり、
store.js はそれを読まない。**4言語目を足す作業がデータ編集だけで済む**のはこの性質のおかげなので、
`const LANGS = [...]` を store.js に足して台無しにしないこと。

### 4.5 他言語を壊さないための保存規約

```js
export function saveProgress(lang, cards) {
  const all = read(K.progress, {}) || {};   // 毎回読み直す。呼び出し側の複製を信じない
  all[lang] = cards;
  return write(K.progress, all);
}
```

**「全言語まとめて保存する関数」を公開しない。** `loadAllProgress()` の結果をアプリ状態に
持ったまま主言語を切り替え、あとで書き戻す——これがこの設計で他言語の進捗を消しうる
唯一の経路であり、唯一の防御は「そういう関数が存在しないこと」である。
アプリ側も `state.cards` に**現在の言語ぶんだけ**を持ち、全言語マップは持たない。

現行の `js/app.js:206` と `:219` は採点のたびに `store.saveCards(state.cards)` を呼んでいる。
これは `store.saveCard(state.primary, card)` に置き換える。1枚だけの read-modify-write なので、
3×150枚（約60KB）の全件 stringify をホットパスから外せる。

### 4.6 書き出し envelope v3

```json
{
  "kind": "polyglot-trainer-progress",
  "version": 3,
  "exportedAt": "2030-04-21T22:10:03.000Z",
  "settings": { "primary": "pt", "showLangs": ["pt", "es", "it", "en"] },
  "progress": {
    "pt": { "greet-01": { "id": "greet-01", "box": 2, "lapses": 0, "due": "2030-04-13",
                          "firstSeen": "2030-04-10", "lastSeen": "2030-04-11",
                          "gradedOn": "2030-04-11", "dayWorst": "good", "preBox": 1 } },
    "es": {},
    "it": { "greet-01": { "id": "greet-01", "box": 1, "lapses": 0, "due": "2030-04-22",
                          "firstSeen": "2030-04-21", "lastSeen": "2030-04-21",
                          "suspended": true, "suspendedOn": "2030-04-21" } }
  },
  "trips": {
    "pt": { "departure": "2030-05-20", "sweepOrder": ["greet-01", "greet-02"] },
    "it": { "departure": "2030-09-01" }
  },
  "meta": { "streak": 12, "lastDone": "2030-04-21", "totalSessions": 31 }
}
```

`sweepOrder` も書き出す。スイープ期間中に機種変更しても凍結した並びが復元される。

書き出したJSONには全言語の出発日が入るので、**リポジトリにコミットしない**（現行と同じ注意）。

### 4.7 読み込み（v2 / v3 両対応）

**両バージョン共通の規則: ファイルに入っている言語スロットだけを置き換え、
入っていない言語スロットには触らない。**
旧形式（`version: 2`）のファイルは pt を復元し、es / it はそのまま残す。
旧ファイルは es / it について何の情報も持たないのだから、消すより残すほうが常に正しい。

```js
export function importJSON(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object') throw new Error('JSONの形式が違います');

  let slices, trips;
  if (data.progress && typeof data.progress === 'object' && !Array.isArray(data.progress)) {
    slices = data.progress;                                   // version 3
    trips  = (data.trips && typeof data.trips === 'object') ? data.trips : {};
  } else if (data.cards && typeof data.cards === 'object' && !Array.isArray(data.cards)) {
    slices = { [LEGACY_LANG]: data.cards };                   // version 2（旧形式）
    trips  = data.trip ? { [LEGACY_LANG]: data.trip } : {};
  } else {
    throw new Error('progress も cards も見つかりません。このアプリの書き出しファイルではありません');
  }

  // 先に全スロットを検証してから、1つも書かないか全部書くかにする
  for (const [lang, cards] of Object.entries(slices)) {
    if (!cards || typeof cards !== 'object' || Array.isArray(cards)) {
      throw new Error(`${lang} の進捗の形式が違います`);
    }
  }

  const all = read(K.progress, {}) || {};
  for (const [lang, cards] of Object.entries(slices)) all[lang] = cards;
  if (!write(K.progress, all)) throw new Error('保存に失敗しました。端末の空き容量を確認してください');
  // ... trips / meta / settings も同様に、既知のキーだけを pick() して書く
}
```

検証を全部済ませてから書く2段構えにする。壊れた多言語ファイルで**一部だけ書き込まれる**のが
ここで起こりうる最悪の結果だからである。

`pick(obj, ALLOWED_FIELDS)` で既知のキーだけを取り込む。これが、廃止した `modeOverride` が
古い書き出しファイル経由で戻ってくるのを防ぎ、手編集したファイルによる任意キー注入も防ぐ。

読み込みは移行を実行せず、`pt.*` に触らない。

### 4.8 旧データからの自動移行

```js
/**
 * pt.cards / pt.meta / pt.trip → poly.* への一度きりの移行。
 * 旧キーは消さない（移行の失敗や、古いキャッシュのapp.jsからの復旧のため）。
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
  try { cards = JSON.parse(rawCards); } catch (e) { /* 壊れている */ }
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) {
    if (!already) write(K.progress, {});   // 器は作る。旧キーは残るので手で復旧できる
    return { migrated: false, reason: 'legacy-unreadable' };
  }

  const all = already ? (read(K.progress, {}) || {}) : {};
  all[LEGACY_LANG] = cards;                // カードは一切加工しない
  if (!write(K.progress, all)) return { migrated: false, reason: 'write-failed' };

  const trip = read(LEGACY.trip, null);
  if (trip && typeof trip.departure === 'string') {
    const trips = read(K.trips, {}) || {};
    if (!trips[LEGACY_LANG]) trips[LEGACY_LANG] = { departure: trip.departure };
    write(K.trips, trips);
  }

  const lm = read(LEGACY.meta, null);
  if (lm && localStorage.getItem(K.meta) === null) {
    write(K.meta, pick({ ...DEFAULT_META, ...lm,
      migratedFrom: 'pt.*', migratedAt: new Date().toISOString() }, META_FIELDS));
  }

  if (localStorage.getItem(K.settings) === null) {
    write(K.settings, { primary: LEGACY_LANG, showLangs: null });  // null = データ側の既定に従う
  }

  return { migrated: true, reason: 'ok', count: Object.keys(cards).length };  // 旧キーは削除しない
}
```

要点:

1. **冪等性の判定は `poly.progress` の生の存在**で行う。`JSON.parse` を通した後だと
   「空オブジェクト」と「キーが無い」を区別できない。別途 `migrated` フラグを持つ案は、
   フラグと実データが食い違いうるので採らない
2. **新規利用者でも `{}` を書く。** これで判定が自己武装し、この関数は1プロファイルにつき
   最大1回しか実際の仕事をしない。以後の起動コストは `getItem` 1回だけ
3. **カードは無改変でコピーする。** `suspended: false` の補填もしない。既存の消費側はすべて
   欠損フィールドに耐える（`card.box || 1` など）し、v2 の追加フィールドは「不在＝既定」だからである
4. **書き込み失敗は settings / meta に触る前に中断**し、`poly.progress` を不在のまま残す。
   次回起動で再試行される
5. **旧キーは消さない。** 設定画面の「旧データ（pt.cards）から取り込み直す」
   （`migrateLegacy({force:true})`、確認ダイアログ付き）の復旧経路にも要る

呼び出し位置は `js/app.js` の `main()` の**最初の文**、どの `loadProgress` よりも前。
同期関数で、`read` / `write` がすべて try/catch されているので例外を投げない。

---

## 5. SRS の変更点

設計上の制約: **`js/srs.js` は純関数のままで、言語を知らない。**
1言語ぶんのカードマップとフレーズ配列を受け取るだけで、「言語」という概念を持たない。
フレーズオブジェクトから読むのは引き続き `.id` だけである。

### 5.1 変えないもの

`pad` / `dayNum` / `fromDayNum` / `addDays` / `diffDays` / `isoFromDate` / `isValidTrip` /
`sweepStart` / `modeFor` / `daysUntilDeparture` / `sweepDays` / `repsFor` / `worseOf` /
`SEVERITY` / `nextState` / `introduce`、および5つの定数すべて。
`NEW_PER_DAY` / `REVIEW_CAP` / `SWEEP_CAP` を据え置くので、45日計画とそのシミュレーションが
そのまま有効である。

### 5.2 追加する関数

```js
/**
 * 出題対象になるカードだけを返す。次の2種類を落とす。
 *   - suspended: 「必要なし」で止めたカード
 *   - orphan:    phrases.json から消えたフレーズのカード（記録は残すが出題しない）
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

export function isSuspended(card)                 // !!(card && card.suspended)
export function suspend(card, today)              // 4.2
export function suspendNew(id, today)             // 4.2
export function unsuspend(card, today)            // 4.2

/** ホームの「定着 N / M」。除外は分母からも分子からも外れる */
export function retentionStats(cards, allPhrases) {
  let retained = 0, introduced = 0, suspended = 0;
  allPhrases.forEach((p) => {
    const c = cards[p.id];
    if (!c) return;
    if (c.suspended) { suspended += 1; return; }
    introduced += 1;
    if (isRetained(c)) retained += 1;
  });
  return { retained, total: allPhrases.length - suspended, introduced, suspended };
}

/** phrases.json から消えたフレーズのカード。設定画面の掃除用 */
export function orphanIds(cards, allPhrases)

/**
 * スイープ用の並び。凍結済みの並びがあれば既存要素の位置を1つも動かさず、
 * 未知のIDだけを末尾に足す。消えたIDも位置を保つために残す（カードが無いので出題されない）。
 */
export function resolveSweepOrder(frozen, allPhrases) {
  const ids = allPhrases.map((p) => p.id);
  if (!Array.isArray(frozen) || frozen.length === 0) return ids;
  const known = new Set(frozen);
  return frozen.concat(ids.filter((id) => !known.has(id)));
}
```

### 5.3 変更する関数

**`isRetained(card)`**（`js/srs.js:136`）

```js
export function isRetained(card) {
  return !card.suspended && (card.box || 1) >= 4;
}
```

`retentionStats` が既に除外を落としているので二重の防御だが、`js/app.js:84` は現行でも
`isRetained` を直接呼んでおり、また誰かが同じことをする。

**`buildSession(today, cards, allPhrases, trip, opts = {})`**（`js/srs.js:230`）

第5引数 `{ sweepOrder }` を足す。省略すれば現行と完全に同じ挙動になるので、
既存の呼び出しとテストは壊れない。

肝は**2種類のマップを使い分ける**こと。

```js
const active = activeCards(cards, allPhrases);   // 出題対象はこちら

// 「投入済みか」「今日何枚投入したか」は生の cards で数える。
// 除外したカードを新規として出し直さないため、また除外も当日の新規枠を使うため。
const introducedToday = Object.values(cards).filter((c) => c.firstSeen === today).length;
const newIds = allPhrases.filter((p) => !cards[p.id]).slice(0, quota).map((p) => p.id);
```

復習リスト（`js/srs.js:251-255`）とスイープ（`js/srs.js:240`）は `active` を使う。
この1箇所の差し替えで「除外の除去」と「孤立カードの除去」が同時に満たされる。
結果として `js/app.js:165` の `state.byId[item.id] === undefined` によるクラッシュは
**構造的に起こりえなくなる**。`buildSession` が返すidは必ず `allPhrases` 由来だからである。

**`buildReplay(today, cards, allPhrases)`**（`js/srs.js:277`）

第3引数を**必須**にする。任意引数にすると、渡し忘れた呼び出しが静かに孤立ガードを失って
描画時にクラッシュする——まさにこの変更が消そうとしている失敗モードそのものになる。

この変更により、**今日除外したカードは再挑戦リストにも出なくなる**（`firstSeen === today`
でも `active` に居ないため）。これは正しい。

**`sweepPlan(orderedIds, cards, trip)`**（`js/srs.js:173`）

シグネチャは変えない。内部で2点だけ変える。

```js
orderedIds.forEach((id, i) => {
  const card = cards[id];
  if (!card) return;             // 未投入 / 除外 / 消えたフレーズ

  let base = i % n;

  // スイープ中に除外を解除したカードは、基準日が過ぎていればその日に引き直す。
  // 移動は必ず未来方向。「有効なカードは出発までに必ず1回は出る」を壊さないため。
  const u = card.unsuspendedOn;
  if (u && raw[u] !== undefined) {
    const uIdx = days.indexOf(u);
    if (uIdx > base) base = uIdx;
  }

  raw[days[base]].push({ id, base: true });
  /* ...以降は現行のまま... */
});
```

並べ替えの比較関数（`js/srs.js:209-214`）は `cards[b.id].lapses` を無防備に参照している。
現行では全エントリがカード由来なので安全だが、マップが呼び出し側でフィルタされるように
なるので `(cards[b.id]?.lapses || 0)` と防御的に書き直す。

### 5.4 `i % n` 網羅保証がフレーズ増減でどうなるか

ここが最も注意を要する。現行の不変性の主張（`js/srs.js:164-167` のコメント）は
「スイープ中に `lapses` が変わっても割り当てが動かない」だけを言っており、
**配列の編集に対しては何も保証していない**。`js/srs.js:195` の `const base = i % n;` は
配列インデックスに依存しているからである。

スイープ期間中に `data/phrases.json` を編集した場合に実際に起きること:

| 編集 | 起きること | 安全か |
|---|---|---|
| **末尾に追記** | 既存フレーズのインデックスが動かないのでスロットも動かない。追記分はカードが無いので `if (!card) return` でスキップされる | **安全** |
| **途中に挿入** | 挿入位置以降の全フレーズがインデックス +1 → スロットが +1 mod n。スロット `n-1`（9日目、まだ未来）だったカードが**スロット0（0日目、すでに過去）へ折り返す**。`plan[today]` は毎日その場で計算されるので、そのカードは二度と出題されない。150枚なら約15枚が消える | **危険** |
| **途中を削除** | 以降が −1。スロットが `today + 1` だったカードが `today` に移り、その日のセッション後に編集していれば出題されない。同じく約15枚 | **危険** |
| **並べ替え** | 大規模な挿入と同じ。ただしスイープ期間外は無害（順序は新規投入順にしか効かず、投入済みは `!cards[p.id]` で弾かれる） | スイープ中のみ危険 |
| **カードを除外** | フィルタ済みマップから1件消えるだけ。**所属は `cards`（マップ）で決まり、位置は `orderedIds`（配列）で決まる**ので、他のカードのスロットは動かない | **安全（構造的に）** |

除外が安全なのは、フィルタを `cards` にだけかけ `orderedIds` には決してかけないからである。
この分離は意図的なので、実装時に崩さないこと。

**対策は編集規約と構造的防御の両方を採る。**

1. **編集規約**: スイープ期間中は `phrases` 配列への**末尾追記のみ**。
   `check-phrases.mjs` は日付を知らないので、`git show HEAD:data/phrases.json` と id 列を
   比較し、既存フレーズの位置が動いていたら情報レベルで注意を出す（ビルドは失敗させない）
2. **構造的防御**: スイープ突入時に並びを凍結する。`resolveSweepOrder` は凍結配列を
   **絶対にフィルタせず、末尾に足すだけ**なので、インデックス安定性が構成上保証される。
   消えたフレーズはスロットを空席として保持し（その日の枚数が1つ減るだけ）、
   挿入されたフレーズは末尾に着地して何も動かさない

凍結のライフサイクル（`js/app.js`）:

```js
const mode = srs.modeFor(state.today, state.trip);
if (mode === 'sweep') {
  if (!state.trip.sweepOrder) {
    state.trip.sweepOrder = state.phrases.map((p) => p.id);   // 入った瞬間に凍結
    store.saveTrip(state.primary, state.trip);
  }
} else if (state.trip.sweepOrder) {
  store.clearSweepOrder(state.primary);                        // 出たら捨てる
  delete state.trip.sweepOrder;
}
```

`n` は出発日によらず常に `SWEEP_DAYS = 10` なので、スイープ中に出発日を変えても
カレンダー窓がずれるだけでスロット番号は振り直されない。したがって凍結した並びは
出発日の変更では無効化しなくてよい。無効化するのはスイープを抜けたときと
`resetProgress(lang)` のときだけである。

**テストで固定する不変条件**:
スイープ窓内の任意の日 `t` について、`t` の開始時点で有効なすべてのカードが、
ある `d ≥ t` の `plan[d]` に現れる。ただし有効カード数が `SWEEP_DAYS × SWEEP_CAP = 250` を
超えないこと。`unsuspendedOn` による前方移動が、この保証を「スイープ開始時点で有効」から
「スイープ中の任意時点で有効」へ拡張する。

### 5.5 網羅保証の容量上限（新たに判明した制約）

**スイープの網羅が保証されるのは有効カードが `SWEEP_DAYS × SWEEP_CAP = 10 × 25 = 250枚`
以下のときだけである。** これを超えると `js/srs.js:244` の `all.slice(0, SWEEP_CAP)` が
1回目の割り当て（base エントリ）まで切り捨て、**出題されないカードが無警告で発生する**。
ちょうど250枚のときは弱点カードの2回目・3回目がすべて消える。

150枚なら安全（1日15枚）だが、この崖はコードのどこにも書かれていない。
`check-phrases.mjs` で 200枚超を警告・250枚超をエラーにし、README にも算術を書く。

### 5.6 「必要なし」の劣化ケース（許容し、記録する）

スイープ最終日に30枚まとめて復活させると、その日のバケットに base エントリが30個入り、
`slice(0, SWEEP_CAP)` が5枚落とす。base エントリが先頭にソートされる（`js/srs.js:209-214`）ので
落ちるのは「lapses の少ない base」と全ての追加分である。
機構を足して守るほどのことではないので、README に注記するにとどめる。

---

## 6. 画面仕様

画面の構成（5つの `<section class="screen">` を `show(name)` で切り替える、`js/app.js:47-51`）は
変えない。変えるのはセッション画面のカード、採点行、ホーム、設定である。

### 6.1 セッション画面 — レイアウトの前提条件

現行の `.card` は `flex: 1; justify-content: center`（`css/style.css:290-296`）で、
`100dvh` の画面の中で縦中央に置かれている。4言語を並べるとカードがビューポートを超え、
**ページ全体が伸びて採点行が画面外に落ちる**。これはこの拡張で最初に潰すべき問題である。

**セッション画面をビューポートに閉じ込め、カードだけをスクロールさせる。**

```css
#screen-session {
  height: 100dvh;
  max-height: 100dvh;
  overflow: hidden;          /* ページ自体はスクロールさせない */
}

.card {
  flex: 1 1 auto;
  min-height: 0;             /* flex子をスクロールさせるのに必須 */
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  justify-content: center;   /* 短いカードは中央 */
  text-align: center;
}

/* 長いカードで justify-content:center が先頭を切り落とす flexbox の罠を避ける */
.card.is-long { justify-content: flex-start; }

.actions { flex: 0 0 auto; margin-top: 16px; }
```

`renderCard()` / `reveal()` の末尾で
`card.classList.toggle('is-long', card.scrollHeight > card.clientHeight)` を呼ぶ。
`.actions` を `flex: 0 0 auto` にしないと、背の高いカードに押されて採点行が縮む。

スクロールできることを示すため、採点行の上に地色へのグラデーションを1本置く。

```css
.actions { position: relative; }
.actions::before {
  content: ""; position: absolute; left: 0; right: 0; top: -20px; height: 20px;
  background: linear-gradient(to bottom, transparent, var(--bg));
  pointer-events: none;
}
```

### 6.2 セッション画面 — カードの構造

`index.html:69-84` を置き換える。

```html
<div id="card" class="card">
  <p id="card-scene" class="card-scene"></p>
  <p id="card-jp" class="card-jp" lang="ja"></p>

  <div id="card-back" class="card-back hidden">

    <!-- 採点される言語。常にこのスロットが最も大きい -->
    <section id="card-primary" class="lang-primary" aria-live="polite">
      <p class="lang-chip"><span id="primary-chip">PT</span></p>
      <p id="primary-text" class="lang-primary-text"></p>
      <p id="primary-kana" class="lang-primary-kana" lang="ja"></p>
      <div class="audio-row">
        <button id="btn-replay" class="ghost">もう一度聞く</button>
        <button id="btn-slow" class="ghost">ゆっくり</button>
      </div>
      <p id="primary-note" class="lang-note" lang="ja"></p>
    </section>

    <!-- 参考。採点されない -->
    <p class="ref-heading">参考</p>
    <ul id="ref-list" class="ref-list"></ul>

    <details id="ref-notes" class="ref-notes hidden">
      <summary>他の言語のメモ</summary>
      <dl id="ref-notes-body" class="card-meta"></dl>
    </details>
  </div>
</div>
```

参照行は `['pt','es','it','en'].filter(l => l !== state.primary)` について JS で組み立てる。
`status: "draft"` の言語は出さない。

```html
<li class="ref-row">
  <button class="ref-play" data-lang="es" aria-label="スペイン語を再生">
    <span aria-hidden="true">▶</span><span>ES</span>
  </button>
  <div class="ref-body">
    <p class="ref-text" lang="es-ES">Buenos días.</p>
    <p class="ref-kana" lang="ja">ブエノス ディアス</p>
  </div>
</li>
```

`en` は `hasKana: false` なので `.ref-kana` を出さない。
`#primary-text` の `lang` 属性は `renderCard()` が動的に設定する（`pt-PT` / `es-ES` / `it-IT`）。
これは既存の不具合の修正でもある。`index.html:2` が `lang="ja"` なので、現行の `#card-pt` は
スクリーンリーダーが**日本語の声でポルトガル語を読む**。

`p.langs[lang]` が未定義でも落ちないこと（`draft` の言語や、データ整備の途中）。
本文は「（未収録）」、再生ボタンは `disabled` にする。

### 6.3 セッション画面 — CSS

新しいトークン（`:root` の両ブロック、`css/style.css:3-17` と `19-33` に追加）:

```css
:root {
  --skip: #5a6472;        /* 必要なし の静止色。--bg 上で 5.6:1 */
  --skip-fill: #4b5563;   /* 確定状態の塗り。白文字で 7.6:1 */
  --skip-on-fill: #ffffff;
}
@media (prefers-color-scheme: dark) {
  :root { --skip: #8d99a8; --skip-fill: #8d99a8; --skip-on-fill: #10161c; }
}
```

それ以外は既存トークンを使い回す。`--azul`（主言語）、`--ink`（参照本文）、
`--ink-soft`（カナ・メモ）、`--line`（区切り線・ピルの枠）、`--terra`（シーン名、変更なし）。

```css
.card-back { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); }

/* ---- 主言語 ---- */
.lang-chip { margin: 0 0 6px; font-size: 0.66rem; font-weight: 600;
             letter-spacing: 0.16em; color: var(--azul); }
.lang-primary-text { margin: 0; font-size: 2rem; line-height: 1.3; font-weight: 500;
                     color: var(--azul); overflow-wrap: anywhere; }
.lang-primary-kana { margin: 8px 0 0; font-size: 1rem; line-height: 1.5;
                     color: var(--ink-soft); letter-spacing: 0.04em; }
.audio-row { display: flex; justify-content: center; gap: 8px; margin-top: 12px; }
.ghost { min-height: 44px; }   /* 既存の修正。下記参照 */
.lang-note { margin: 12px 0 0; font-size: 0.82rem; line-height: 1.6;
             color: var(--ink-soft); text-align: left; }

/* ---- 参照言語 ---- */
.ref-heading { margin: 22px 0 10px; padding-top: 14px; border-top: 1px solid var(--line);
               font-size: 0.66rem; letter-spacing: 0.16em; color: var(--ink-soft); text-align: left; }
.ref-list { list-style: none; margin: 0; padding: 0; }
.ref-row { display: grid; grid-template-columns: 56px 1fr; gap: 10px;
           align-items: start; text-align: left; padding: 6px 0; }
.ref-play { display: flex; align-items: center; justify-content: center; gap: 3px;
            min-height: 44px; padding: 0 6px; background: transparent; color: var(--ink-soft);
            border: 1px solid var(--line); border-radius: 999px;
            font-size: 0.7rem; font-weight: 600; letter-spacing: 0.06em; }
.ref-play:active { background: var(--line); }
.ref-play[disabled] { opacity: 0.4; }
.ref-body { padding-top: 2px; min-width: 0; }
.ref-text { margin: 0; font-size: 0.98rem; line-height: 1.45;
            color: var(--ink); overflow-wrap: anywhere; }
.ref-kana { margin: 2px 0 0; font-size: 0.78rem; line-height: 1.4; color: var(--ink-soft); }
```

**主言語の優位は4つの信号で同時に伝える** — 大きさ（2rem 対 0.98rem = 2:1）、色
（`--azul` 対 `--ink`）、揃え（中央 対 左）、装飾（名前付きテキストボタン 対 56pxのタグピル）。
参照ブロックはさらに「参考」という見出しと罫線の下に置くので、追加の解答ではなく付録として読める。

### 6.4 縦方向の収まり

内容幅は `min(560, 100vw) − 40`。

| 端末 | 内側の高さ | − セッションバー | − 採点行＋必要なし行 | **カードの持ち分** |
|---|---|---|---|---|
| iPhone SE 375×667 | 627 | 64 | 158 | **405** |
| iPhone 14 390×844 | 763 | 64 | 158 | **541** |

中央値のフレーズ（jp 9文字 / pt 19文字 / カナ 14文字）で実測すると、
シーン名40 + 日本語38 + 罫線38 + チップ24 + 本文43 + カナ38 + 音声行50 + メモ32 +
参考見出し28 + 参照2行112 + 英語行56 ≒ **506px**。

つまり **iPhone 14 は中央値のカードがスクロールなしで収まる**。iPhone SE は約100pxスクロールするが、
主言語ブロックは278pxで終わるので**採点対象の文・カナ・音声ボタンは常に画面内**にあり、
参照1行目が半分見えてスクロールの手がかりになる。最長のフレーズ
（`Queria os papéis para o reembolso do IVA.`）は約660pxでどの端末でもスクロールするが、
採点行は動かない。

背の低い画面で約55pxを回収する:

```css
@media (max-height: 700px) {
  .session-bar { margin-bottom: 16px; }
  .card-scene { margin-bottom: 12px; }
  .card-jp { font-size: 1.4rem; }
  .lang-primary-text { font-size: 1.75rem; }
  .actions { margin-top: 10px; }
  .grade-row { margin-top: 14px; }
  .skip-row { margin-top: 10px; padding-top: 8px; }
}
```

### 6.5 メモの置き場所

- **主言語のメモ**は常時表示（`#primary-note`）。学習に効くのはこれで、大きな本文と
  結びついている必要がある。中央値22文字＝0.82remで1行
- **参照言語のメモ**は最下部の `<details>`（「他の言語のメモ」）にまとめる。
  中身は既存の `.card-meta` スタイル（`css/style.css:334-351`）を再利用した `<dl>`。
  非空のメモが1つもなければ `<details>` ごと出さない。
  3つ並べて常時表示するのは、まさに避けたい「文字の壁」である

### 6.6 採用しなかったレイアウト

- **タブ切替（ES / IT / EN を1つずつ表示）** — 約110px節約できる。しかし
  「全言語を同時に見て比較する」という機能の目的そのものにタップを1つ挟むことになる。
  カードごとにリセットが要る状態も増える
- **2×2の等分グリッド** — 主言語が他と対等になり「主言語が一目で分かる」要件に真っ向から反する。
  560px幅で各セル260pxなので、41文字の文が4行に折り返して不揃いになる
- **`.card-meta` を流用した1枚の対応表** — 言語ごとの再生ボタンが `dt`/`dd` のリズムに収まらず、
  タップ領域が44pxを割る。6.3の参照スタックはこの案を正しく作り直したものである

### 6.7 「必要なし」ボタンの配置

**採点行は3列のまま変えず、その下に独立した行を置く（3+1）。**

4列グリッドにしない理由:

| レイアウト | 375px | 320px | 560px |
|---|---|---|---|
| 3列（現行） | 106.3px、ピッチ114 | 88px | 173px |
| 4列 | 77.8px、ピッチ86 | **64px** | 124px |

44pxの最小値自体は4列でも満たす。問題は別のところにある。

1. **ピッチが114pxから86pxに落ちる。** 成人の親指の接地幅は45〜57px。86pxピッチで8pxギャップだと、
   右手親指が自然に置かれる**行の右端**で隣接誤タップが常態化する
2. **最悪の隣接**が生まれる。4列だと「必要なし」が「できた」の隣、しかも親指が届きやすい右端に来る。
   どちらも肯定的に感じられるボタンなのに、片方はカードを学習から外す
3. **段階のある尺度に見える。** `だめ → あいまい → できた → 必要なし` は「できたより良い」と
   読めてしまう。そもそも同じ軸の上にない
4. 320pxでは「必要なし」「あいまい」が64pxのセルに1remで入らず、確実に折り返す

加えて、3列は `1 / 2 / 3` のキー配置（`js/app.js:432-434`）と空間的に対応している。
触らなければ両方の身体記憶が保たれる。

```html
<div class="actions">
  <button id="btn-reveal" class="primary">答えを見る</button>

  <div id="grade-row" class="grade-row hidden">
    <button class="grade again" data-grade="again">だめ</button>
    <button class="grade vague" data-grade="vague">あいまい</button>
    <button class="grade good"  data-grade="good">できた</button>
  </div>

  <button id="btn-next" class="primary hidden">次へ</button>

  <div id="skip-row" class="skip-row hidden" aria-live="polite">
    <button id="btn-skip" class="skip">必要なし</button>
    <div id="skip-confirm" class="skip-confirm hidden">
      <button id="btn-skip-cancel" class="skip-cancel">やめる</button>
      <button id="btn-skip-yes" class="skip-yes">除外する</button>
    </div>
  </div>
</div>
```

```css
.grade-row { margin-top: 20px; }   /* 24 → 20。必要なし行のぶんを捻出 */
.skip-row { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.skip { display: block; width: 100%; min-height: 44px; background: transparent;
        color: var(--skip); border: none; border-radius: var(--radius); font-size: 0.9rem; }
.skip:active { background: color-mix(in srgb, var(--skip) 12%, transparent); }
.skip-confirm { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.skip-confirm.is-arming { pointer-events: none; }   /* タップ貫通防止。350msだけ */
.skip-cancel { min-height: 44px; background: transparent; color: var(--ink-soft);
               border: 1px solid var(--line); border-radius: var(--radius); font-size: 0.9rem; }
.skip-yes { min-height: 44px; background: var(--skip-fill); color: var(--skip-on-fill);
            border: none; border-radius: var(--radius); font-size: 0.9rem; font-weight: 500; }
```

**色**: 「必要なし」は記憶の軸の上の点ではないので、採点色を借りない。
`--again` は2行上で「だめ」の意味を持っているので特に不可。`--terra` はシーン名・見出し・
進捗バーで使われている情報色なので操作色に転用しない。
**両状態とも無彩色にし、色相ではなく塗りで区別する** — 静止時は透明地に `--skip` の文字、
確定待ちは `--skip-fill` の塗りに `--skip-on-fill` の文字。塗り＝確定を意味する。
コントラスト: `#5a6472` on `#faf7f2` = 5.6:1 / `#8d99a8` on `#14181d` = 8.9:1 /
白 on `#4b5563` = 7.6:1 / `#10161c` on `#8d99a8` = 6.3:1。

**確認の方式: その場で2段階。モーダルもトーストも使わない。**

- モーダル `confirm()` は不適切。このコードベースでは本当に取り返しがつかないリセット
  （`js/app.js:412`）に予約されている。「必要なし」は除外リストから完全に戻せる
- 消えるトーストも不適切。**次のカードの操作領域に重なる**ため、二次的な誤タップ源になる
- **同じ枠・同じ44pxの高さのまま `[やめる] [除外する]` に入れ替える**ので、
  レイアウトシフトがゼロ。5秒で自動的に元に戻り、`Escape` で取り消せる
- **タップ貫通の防御は必須**: 確定待ちに入ってから **350ms** は `pointer-events: none`。
  これがないと同じ場所への2度目のタップが「除外する」に着弾する
- 並びは「やめる」が左、「除外する」が右（日本語の取消し左寄せの慣習）
- 持続的なフィードバックはトーストではなく、ホームの除外件数と設定の除外リストが担う

### 6.8 新規カードでの「必要なし」

新規カードは最初から解答が見えていて「次へ」だけが出る（`js/app.js:167, 183-188`）。
判定はこう変わる。

```js
$('grade-row').classList.toggle('hidden', item.kind === 'new' || !state.revealed);  // 現行のまま
$('btn-next').classList.toggle('hidden', item.kind !== 'new');                       // 現行のまま
$('skip-row').classList.toggle('hidden', !state.revealed);                           // 追加
resetSkipConfirm();                                                                  // 追加。毎描画
```

新規カードは常に `revealed` なので、`#skip-row` は新規カードでも解答済み復習カードでも出る。

```
[        次へ        ]     ← .primary、全幅
────────────────────────    ← 罫線
[      必要なし      ]     ← .skip
```

**新規カードで確定したとき**:

```js
state.cards[id] = srs.suspendNew(id, state.today);
store.saveCard(state.primary, state.cards[id]);
audio.stop(); advance();
```

**復習カードで確定したとき**:

```js
state.cards[id] = srs.suspend(card, state.today);   // nextState() は呼ばない。採点ではない
store.saveCard(state.primary, state.cards[id]);
// 「だめ」で末尾に積まれた同じidの重複を、現在位置より後ろから取り除く
state.queue = state.queue.filter((q, i) => i <= state.index || q.id !== item.id);
audio.stop(); advance();
```

重複の掃除は必須である。`grade('again')` はキューの末尾に同じidを積む（`js/app.js:210`）ので、
そのあと除外すると**除外したはずのカードが同じセッションの後半で再浮上する**。
`renderCard()` は分母を毎回 `state.queue.length` から取り直す（`js/app.js:171`）ので、
表示も自動的に整合する。

既知の許容挙動: 全カードを除外しただけのセッションでもストリークは加算される
（`state.queue.length > 0`、`js/app.js:235`）。利用者は実際に時間を使っている。特例は設けない。

### 6.9 キーボード操作

数字が採点、アルファベットが音声。1つのキーが両方を担わない。

| キー | 状況 | 動作 |
|---|---|---|
| `Space` / `Enter` | 新規カード | 次へ（現行のまま） |
| `Space` / `Enter` | 復習・未解答 | 答えを見る（現行のまま） |
| `Space` / `Enter` | 必要なしの確定待ち | **確認を取り消す**（安全側。キー入力を消費する） |
| `1` `2` `3` | 復習・解答済み | だめ / あいまい / できた（現行のまま、`js/app.js:432-434`） |
| `4` | 解答済み（新規・復習とも） | 必要なしを確定待ちに。5秒以内にもう一度 `4` で確定 |
| `Escape` | 必要なしの確定待ち | 取り消す |
| `p` `s` `i` `e` | 解答済み | ポルトガル語 / スペイン語 / イタリア語 / 英語を再生 |
| `0` | 解答済み | 主言語を ゆっくり ⇄ 標準 で切り替えて再生 |

- 主言語と同じ言語キーは主言語の経路で鳴らし、現在の「ゆっくり」設定に従う。
  他の3つは常に 1.0 で鳴らす
- `Space`/`Enter` が確定待ちを取り消すのは重要。これがないと `js/app.js:427` の
  `if (item.kind === 'new') nextNew()` が確定待ちのカードを飛ばし、意図が黙って捨てられる
- `4` は `1/2/3` より広い条件で効かせる。`item.kind === 'review' && state.revealed` ではなく
  `state.revealed` だけ（新規カードでも押せる必要があるため）
- 「ゆっくり」に `s` を使わないのは español に取られているため。`0` は数字列の隣にあり、
  主言語に対する修飾という位置づけが合う

`keydown` ハンドラ（`js/app.js:420`）に必要なガード:

```js
if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;   // 日本語IME・Cmd+P 等
if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
const k = e.key.toLowerCase();                                      // Shift併用でも通す
```

`.card` がスクロール可能になったので `Space` はカードをスクロールしうる。既存の
`preventDefault()`（`js/app.js:426`）は残す。矢印キー・トラックパッド・タッチでのスクロールは効く。
`p` / `s` / `i` / `e` / `0` / `4` は Safari / Chrome で修飾なしの既定動作を持たない。

一覧は設定画面に置く（オーバーレイにしない）。

### 6.10 ホーム画面

```
                                                 [設定]

              [  ポルトガル語  ›  ]         ← 言語インジケータ（タップで設定へ）

                     出発まで
                       45 日
                  出発 2030-05-20

           連続日数 3          定着 12/147

           ▓▓▓▓░░░░░░░░░░░░░░░░

           [   今日の10分をはじめる   ]

                 復習 8 / 新規 5
              除外したフレーズ 3件を見る ›
```

`.home-top` の先頭（`index.html:34` の直後）に足す:

```html
<button id="btn-lang" class="lang-indicator" aria-label="学習中の言語。設定で切り替える">
  <span id="lang-name">ポルトガル語</span>
  <span class="chev" aria-hidden="true">›</span>
</button>
```

`#home-today`（`index.html:57`）の直後に足す:

```html
<button id="btn-excluded" class="link-row hidden">
  除外したフレーズ <span id="excluded-count">0</span>件を見る ›
</button>
```

```css
.lang-indicator { align-self: center; display: inline-flex; align-items: center; gap: 6px;
                  min-height: 40px; padding: 0 16px; margin-bottom: 20px;
                  background: var(--surface); color: var(--ink);
                  border: 1px solid var(--line); border-radius: 999px; font-size: 0.9rem; }
.lang-indicator .chev { color: var(--ink-soft); }
.link-row { display: block; width: 100%; min-height: 44px; margin-top: 4px;
            background: transparent; border: none;
            color: var(--ink-soft); font-size: 0.85rem; text-align: center; }
```

ピルは中央寄せ、`#btn-settings` は `position:absolute; right:16px`（`css/style.css:236,244`）。
320px幅でピルは概ね x=95..225、設定は右端から x=16..60 なので衝突しない。

表示の導き方:

- `#lang-name` — `envelope.langs[state.primary].label`
- `#departure-note` — 「出発 2030-05-20」。スイープ / 旅行中の文言（`js/app.js:100, 110`）は変えない
- `#retained` — 除外でないカードのうち `box >= 4` の数
- `#total` — `state.phrases.length − 除外数`。`#progress` の幅も同じ分母を使う。
  **ゼロ除算をガードする**（`total ? retained / total : 0`）。現行の `js/app.js:87` は無防備
- 150が147に静かに減ると不具合に見えるので、`除外したフレーズ N件を見る` の行を
  真下に必ず出す。これが説明そのものになるので、追加の説明文は置かない。
  `aria-label="定着 12 / 対象 147。除外3件を除く"` を添える
- `#excluded-count` — **主言語ぶんだけ**。0のときは行ごと隠す。全言語の一覧は設定側に置く

`#btn-lang` と `#btn-excluded` はどちらも設定画面へ飛ぶ。後者は `show('settings')` のあと
除外リストへ `scrollIntoView({ block: 'start' })` する。

**出発日が未設定の言語のホーム**:

```
              [  スペイン語  ›  ]
                     出発まで
                        —
             この言語の出発日が未設定です
           連続日数 0          定着 0/150
           [    出発日を設定する    ]
```

`#btn-start` は**押せる状態**にして設定画面の該当日付欄へ飛ばす。
これが言語切替を袋小路にしないための要である（6.12参照）。

### 6.11 設定画面

`index.html:117-145` を置き換える。並び順は「どの言語か → 予定 → 診断 → 除外 → データ → デバッグ」。

```html
<div class="settings-body">

  <h2>学習する言語</h2>
  <div class="lang-switch" role="radiogroup" aria-label="学習する言語">
    <label class="lang-opt"><input type="radio" name="primary-lang" value="pt"><span>ポルトガル語</span></label>
    <label class="lang-opt"><input type="radio" name="primary-lang" value="es"><span>スペイン語</span></label>
    <label class="lang-opt"><input type="radio" name="primary-lang" value="it"><span>イタリア語</span></label>
  </div>
  <p id="lang-switch-note" class="sub">採点されるのはここで選んだ言語だけ。残りの2言語と英語は答えの下に
    参考として並ぶ。進捗・出発日・除外リストは言語ごとに分かれて保存され、切り替えても消えない。</p>

  <h2>出発日</h2>
  <div class="dep-grid">
    <label class="dep-row"><span class="dep-lang">ポルトガル語</span>
      <input type="date" id="dep-pt" class="date-input" aria-label="ポルトガル語の出発日"></label>
    <label class="dep-row"><span class="dep-lang">スペイン語</span>
      <input type="date" id="dep-es" class="date-input" aria-label="スペイン語の出発日"></label>
    <label class="dep-row"><span class="dep-lang">イタリア語</span>
      <input type="date" id="dep-it" class="date-input" aria-label="イタリア語の出発日"></label>
  </div>
  <p id="departure-error" class="warning hidden"></p>
  <button id="btn-departure-save" class="secondary">出発日を保存</button>
  <p class="sub">この端末のみに保存され、どこにも送信されない。最終スイープは出発日の10日前に自動で始まる。</p>

  <h2>音声（<span id="voice-lang-name">ポルトガル語</span>）</h2>
  <p id="voice-status" class="mono"></p>
  <p id="voice-list" class="mono"></p>
  <p class="sub">警告を出すのは学習中の言語だけ。参考として並ぶ言語の音声は判定しない。</p>

  <h2>進捗</h2>
  <p id="progress-detail" class="mono"></p>
  <p id="progress-all" class="mono"></p>
  <p id="orphan-note" class="sub hidden"></p>

  <h2>除外リスト</h2>
  <p id="excl-summary" class="sub"></p>
  <label class="check-row"><input type="checkbox" id="excl-all-langs"> 他の言語の除外も表示</label>
  <ul id="excl-list" class="excl-list"></ul>
  <p id="excl-empty" class="sub hidden">除外中のフレーズはありません。セッション中に「必要なし」を押すと、
    その言語でだけ出題されなくなる。</p>
  <button id="btn-excl-restore-all" class="secondary hidden">
    表示中のすべてを戻す（<span id="excl-count">0</span>件）</button>

  <h2>データ</h2>
  <button id="btn-export" class="secondary">JSONを書き出す（全言語）</button>
  <label class="file-label">JSONを読み込む
    <input type="file" id="input-import" accept="application/json,.json"></label>
  <button id="btn-reset-lang" class="danger"><span id="reset-lang-name">ポルトガル語</span>の進捗を消す</button>
  <button id="btn-reset-all" class="danger">すべての言語の進捗を消す</button>

  <h2>キーボード操作</h2>
  <details class="keys"><summary>ショートカット一覧</summary>
    <dl class="card-meta">
      <dt>Space / Enter</dt><dd>答えを見る / 次へ</dd>
      <dt>1 / 2 / 3</dt><dd>だめ / あいまい / できた</dd>
      <dt>4</dt><dd>必要なし（もう一度 4 で確定、Esc で取り消し）</dd>
      <dt>P / S / I / E</dt><dd>ポルトガル語 / スペイン語 / イタリア語 / 英語 を再生</dd>
      <dt>0</dt><dd>学習中の言語を ゆっくり ⇄ 標準 で再生</dd>
    </dl>
  </details>

  <h2>基準日</h2>   <!-- index.html:137-140 のまま -->
  <h2>ビルド</h2>   <!-- index.html:141-144 のまま -->
</div>
```

除外リストの1件（JSで組み立て）:

```html
<li class="excl-item">
  <div class="excl-main">
    <p class="excl-jp" lang="ja">Wi-Fiのパスワードは何ですか</p>
    <p class="excl-target"><span class="excl-lang">PT</span>
       <span lang="pt-PT">Qual é a senha do Wi-Fi?</span></p>
    <p class="excl-date">2030-04-18 に除外</p>
  </div>
  <button class="excl-restore" data-id="hotel-06" data-lang="pt"
          aria-label="Wi-Fiのパスワードは何ですか を戻す">戻す</button>
</li>
```

主なCSS:

```css
.lang-switch { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.lang-opt { position: relative; }
.lang-opt input { position: absolute; inset: 0; opacity: 0; margin: 0; width: 100%; height: 100%; }
.lang-opt span { display: flex; align-items: center; justify-content: center; text-align: center;
                 min-height: var(--tap); padding: 8px 4px;
                 border: 1px solid var(--line); border-radius: var(--radius);
                 font-size: 0.8rem; letter-spacing: -0.02em; color: var(--ink-soft); }
.lang-opt input:checked + span { background: var(--azul); color: #fff;
                                 border-color: var(--azul); font-weight: 500; }
.lang-opt input:focus-visible + span { outline: 2px solid var(--azul); outline-offset: 2px; }
@media (prefers-color-scheme: dark) { .lang-opt input:checked + span { color: #10161c; } }

.dep-grid { display: grid; gap: 10px; }
.dep-row { display: grid; grid-template-columns: 6.5em 1fr; align-items: center; gap: 10px; }
.dep-row .date-input { margin-top: 0; }        /* css/style.css:80 の margin-top:20px を打ち消す */
.dep-row.is-active .dep-lang { color: var(--azul); font-weight: 500; }

.excl-item { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
             padding: 12px 0; border-bottom: 1px solid var(--line); }
.excl-lang { display: inline-block; min-width: 2.2em; margin-right: 6px;
             font-size: 0.65rem; font-weight: 600; letter-spacing: 0.08em;
             color: var(--terra); text-align: center; }
.excl-restore { min-height: 44px; min-width: 68px; padding: 0 14px;
                background: transparent; color: var(--azul);
                border: 1px solid var(--azul); border-radius: 999px; font-size: 0.85rem; }
```

320px幅でのスイッチャー: セルは `(280−16)/3 = 88px`、「ポルトガル語」は0.8remで約77px＋余白8px＝85px。
収まり、文字を拡大しても `min-height` なので折り返すだけで壊れない。

**動作**:

- **スイッチャーは確認なしで即時反映。** 切替は非破壊で、戻せばすべて元通りだからダイアログは
  摩擦にしかならない。代わりに即時のフィードバックを出す — `#lang-switch-note` を4秒間
  「スペイン語に切り替えました」に差し替え、下流のすべて（音声の見出し・進捗・除外リスト・
  リセットボタンの文言・`.dep-row.is-active`）を新しい言語で再描画する
- **出発日は3言語ぶんを1画面で編集**する。日付を入れるために言語を切り替える必要がない。
  「出発日を保存」は入力済みの欄をすべて既存規則（`srs.isValidTrip` ＋ 明日以降、`js/app.js:59-67`）で
  検証し、妥当なものだけを書き、最初の失敗を `#departure-error`（既存 `.warning`、
  `css/style.css:247-256`）に「スペイン語の出発日は明日以降にしてください」と出す。空欄は「未設定」で合法
- **音声診断は主言語のみ**。見出しに言語名を入れて曖昧さをなくす
- **進捗**は主言語の詳細（`#progress-detail`）と全言語の要約（`#progress-all`）の2行

  ```
  投入 42/147 / 箱1:8 箱2:10 箱3:12 箱4:7 箱5:5 / 除外 3 / 連続 6日 / セッション 21回
  PT 定着12/147 ・ ES 定着0/150 ・ IT 定着0/150
  ```

- **孤立カード**があれば `#orphan-note` に「孤立した進捗 N件（消えたフレーズの記録）」と
  idを列挙し、明示的な削除ボタンを添える。**自動削除はしない**
  （誤って消したフレーズを戻したとき進捗も戻る必要があるため）
- **除外リスト**は既定で**主言語ぶん**。チェックボックスで全言語に広げる。
  `PT` / `ES` / `IT` のタグは両モードで出す。新しい順に並べる
- **個別の「戻す」に確認は不要**。1件だけの、何度でもやり直せる操作である
- **一括の「表示中のすべてを戻す」には `confirm()`** を出す。30枚まとめて戻すと翌日のキューが
  溢れるので、リセットと同じ扱いにする。対象は常に「いま表示している範囲」で、件数をラベルに出す
- **復活のセマンティクス**は4.2の `unsuspend()` に従う。採点済みは元の箱で当日から復習に戻り、
  未採点は新規として投入し直される
- **書き出しは全言語まとめて1ファイル**。半分しか戻らないバックアップは無いより悪い
- **リセットは2段階**に分ける。言語別（よくある必要「スペイン語をやり直す」）と全言語。
  どちらも `confirm()` を出し、どちらも出発日は残す（現行の `js/store.js:105-108` と同じ方針）

### 6.12 主言語を切り替えたときの状態遷移

スイッチャーは設定画面にしかなく、設定画面はホームからしか開けない（`index.html:32`）ので、
**セッション中の切替は構造的に起こらない**。それでも防御として、`#screen-session` が
表示中なら先に中断処理（`audio.stop()`）を通す。

```js
function setPrimaryLanguage(lang) {
  if (lang === state.primary) return;

  audio.stop();            // 必ず最初。旧言語の発話が画面切替後も鳴り続けるのを防ぐ
  audio.setPrimary(lang);  // ポインタ更新のみ。音声解決は init 時に全言語ぶん済んでいる
  clearSkipConfirm();      // 確定待ちのタイマーを止める

  state.primary = lang;
  store.setPrimary(lang);

  state.cards = store.loadProgress(lang);
  const t = store.loadTrip(lang);
  state.trip = srs.isValidTrip(t) ? t : null;   // null は正常。未設定を許す

  state.queue = []; state.index = 0; state.revealed = false;
  state.slow = false; state.session = null; state.isReplay = false;

  // state.today / state.phrases / state.byId は不変（デッキは全言語共通）
  renderSettings();
}
```

- **捨てるもの**: `cards` / `trip` / `queue` / `index` / `revealed` / `slow` / `session`、
  および宣言されていない `isReplay`（`js/app.js:135, 151` で設定される）と新設の確定待ち状態
- **保つもの**: `today` / `phrases` / `byId`。デッキは全言語共通なので、これが切替を安価にしている
- **`meta` は言語横断**なので読み直さない
- **`js/audio.js` のモジュール状態**（`js/audio.js:9-15`）は、再生中の `HTMLAudioElement` と
  発話キューを既存の `stop()`（`js/audio.js:104-110`）が片付ける。だから最初に呼ぶ。
  `voice` / `voiceStatus` は言語別のマップになり `init()` で一度に解決済みなので、
  `setPrimary(lang)` は非同期処理を伴わない純粋なポインタ更新になる
- **着地する画面は設定画面のまま**。利用者は設定の途中であり、次にやりたいのは
  新しい言語の出発日の入力である可能性が高い。ホームへ飛ばすとその欄が見えなくなる
- **新しい言語に出発日が無いとき**は、初回セットアップ画面へ**飛ばさない**。
  設定済みの言語へ戻る手段を失わせるからである。代わりに
  (1) `#lang-switch-note` を「スペイン語の出発日がまだ設定されていません」にし、
  (2) `#dep-es` にフォーカスして `scrollIntoView`、
  (3) 「戻る」は通常どおり効き、ホームは6.10の未設定バリアントで描画する

**起動時の分岐の変更**（`js/app.js:457`）: `showSetup()` を出すのは**真の初回**
（どの言語にも妥当な旅程が無い）だけにする。それ以外はホームを描画し、主言語に出発日が
無ければ未設定バリアントを出す。真の初回には主言語がまだ無いので、初回セットアップ画面にも
同じ3択スイッチャーを日付入力の上に置き（既定 `pt`）、見出しを「学習する言語と出発日」にする。

### 6.13 アクセシビリティとモバイル

**タップ領域**
- 新規コントロールはすべて `min-height: 44px`
- **既存の不具合を直す**: `.ghost`（`css/style.css:225-233`）は `padding: 9px 16px` の
  0.85rem で約35px。最小44pxに届いていない。「もう一度聞く」「ゆっくり」はこのアプリで
  最も押されるボタンである。`min-height: 44px` を足す
- `-webkit-tap-highlight-color: transparent`（`css/style.css:48`）で既定のタッチ反応が
  消えているので、新規ボタンには必ず `:active` を定義する

**スクリーンリーダー**
- `aria-live="polite"` は `#card-primary` **だけ**に付ける。`#card-back` 全体に付けると
  解答のたびに4言語＋メモを読み上げ、再描画で二重に読む
- `#skip-row` にも `aria-live="polite"`（確定待ちへの遷移を読ませる）
- 要素ごとの `lang`: 本文に `pt-PT` / `es-ES` / `it-IT` / `en-GB`、カナ・日本語・メモに `ja`
- `.ref-play` は「▶ ES」しか出さないので `aria-label="スペイン語を再生"` が必須
- スイッチャーは本物の `radio` を `role="radiogroup"` に入れる。矢印キー操作と状態読み上げが無料で付く

**フォーカス** — 現状は `.date-input:focus` にしかリングがない（`css/style.css:90`）。
キーボード操作は明示的な想定利用者（`js/app.js:419`）なので追加する。

```css
:focus-visible { outline: 2px solid var(--azul); outline-offset: 2px; }
```

**ダークモード** — 新トークンを両ブロックに定義し、`.primary` と同じ文字色反転の型
（`css/style.css:199-201`）に従う。`color-mix()` は既に使われている（`css/style.css:250`）ので安全。

**文字拡大** — 新規のサイズ指定はすべて `rem` ＋ `min-height` で、固定 `height` と
`white-space: nowrap` を使わない。200%では採点ラベルが2行に折り返して行が約76pxに伸びる
（切れるのではなく）。4言語スタックは非常に縦長になるが、スクロールする `.card` が吸収し、
採点行は動かない。6.1の変更が譲れないのはこのためである。

**横向き・低い画面** — 390×390 の横向きでは残り約300pxに対しバー64＋操作158＝222。
6.4の `@media (max-height: 700px)` で約55px回収し、残りはカードのスクロールで吸収する。
375×667 と横向きは実機確認する。

**その他**
- `overscroll-behavior: contain` を `.card` に入れ、iOSでスクロールがページのバウンスへ
  連鎖するのを防ぐ
- `@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }` を足す
  （既存の幅アニメーション `css/style.css:176, 279` と確定待ちの入れ替えのため）
- `#session-stage` は `min-width: 4.5em; text-align: right`（`css/style.css:282-288`）で
  「再挑戦 10/12」で既にきつい。**ここに言語コードを足さない**。カード内の `.lang-chip` が
  識別を担い、セッション中に言語は変わらない

---

## 7. 音声仕様

### 7.1 モジュールの新しいインターフェース

```js
export async function init()                     // 全言語の音声解決 + マニフェスト読み込み
export function setPrimary(lang)                 // stop() + 主言語ポインタ更新。同期・即時
export function speak(phrase, lang, rate = 1.0)  // phrase はレコード全体。phrase.langs[lang].text を読む
export function stop()
export function isAvailable(lang)                // false → その行の再生ボタンを disabled に
export function status(lang = primary)           // { lang, voiceStatus, voiceName, voiceLocale, mp3Count }
export function statusAll()                      // { pt:{…}, es:{…}, it:{…}, en:{…} }
export function warningText()                    // 主言語だけ。問題なければ null
export function listVoices(lang)                 // 設定画面用の文字列配列
```

`speak(phrase, rate)`（`js/audio.js:116`）が `speak(phrase, lang, rate)` になる。
呼び出し側はすべて変わる — `js/app.js:188, 197, 344, 351` と、新設の参照言語の再生ボタン。

### 7.2 音声の解決

言語ごとの設定は `envelope.langs[L].speech`（3.1）から引く。コードに書かない。

| lang | prefer | accept（警告つき代用） | 状態コード |
|---|---|---|---|
| `pt` | `pt-PT` | `pt-BR`, その他の `pt-*` | `ready` / `fallback` / `none` |
| `es` | `es-ES` | `es-419`, `es-MX`, `es-US`, その他の `es-*` | 同上 |
| `it` | `it-IT` | `it-*`（`warn: null` なので警告しない） | 同上 |
| `en` | `en-GB` | `en-US`, `en-AU`, `en-*`（警告しない） | 同上 |

`getVoices()` を1回呼び、言語ごとに `normLang(v.lang).startsWith(prefix)` で絞り、
(prefer と完全一致, `v.localService`（オフラインで使える）, `v.default`) の降順で並べて先頭を採る。
既存の `voiceschanged` 購読と Safari 向けの 10×100ms ポーリング（`js/audio.js:52-58`）は残すが、
再試行のたびに**4言語すべて**を解決し直す。

**警告は主言語だけ**（決定9）。`mp3Sets[lang].size > 0` のときは抑止する
（現行 `js/audio.js:92` と同じ方針）。文言は `speech.warn` をそのまま出し、
`warn: null` の言語では代用が起きても何も出さない。音声が1つも見つからない (`none`) 場合だけは
言語名を差し込んだ共通文を出す。

### 7.3 直すべき既存の不具合

`js/audio.js:130` は `u.lang = 'pt-PT'` を無条件に設定している。`voice` が pt-BR の代用でも
`pt-PT` を宣言するため、どちらが勝つかがエンジンによって食い違い、出力が不安定になる。
新しいコードは**解決したボイスのロケール**を設定し、ボイスが1つも無いときだけ prefer に落とす。

```js
const r = resolved[lang];
u.lang = r.voice ? normLang(r.voice.lang) : PREFERRED[lang];
if (r.voice) u.voice = r.voice;
```

読み上げ前に `text.replace(/\s+\/\s+/g, ', ')` を通す（3.5の `fragment` の二択表記対策）。

`stop()` を `speak()` の先頭で呼ぶ現行の作り（`js/audio.js:117`）は残す。
ES を押した直後に IT を押すと前者が止まる、という挙動が正しい。
iOS の「最初の発話はユーザー操作から」という制約も満たされる。すべての再生経路が
タップ（答えを見る・次へ・再生ボタン）か、タップ起点の `advance()` から呼ばれる
`renderCard()` に由来するためである。

### 7.4 MP3 とマニフェスト

パスを `audio/{lang}/{id}.mp3` にする（現行は `audio/{id}.mp3`、`js/audio.js:7, 120`）。

```json
{ "version": 2,
  "byLang": { "pt": ["greet-01", "greet-02"], "es": [], "it": [], "en": [] } }
```

後方互換: パースした結果が `Array` なら `byLang.pt` として扱う（既存ファイルがそのまま動く）。
`.gitignore` の `audio/*.mp3` は `audio/**/*.mp3` に直す。

---

## 8. ツールとテスト

すべて Node標準機能のみ、依存ゼロ。README には1行でまとめて書く。

```bash
node tools/check-phrases.mjs && node tools/test-srs.mjs && node tools/test-store.mjs
```

### 8.1 `tools/check-phrases.mjs`（新規）

`node tools/check-phrases.mjs [path]`（既定 `data/phrases.json`）。
**ERROR** は exit 1、**WARN** は表示のみで exit 0。すべてのメッセージにフレーズidと配列位置を付ける。

**envelope**
1. JSONとしてパースできる / BOMが無い / 末尾が改行（ERROR / WARN / WARN）
2. `kind === "phrases"` かつ `version === 2`（ERROR）
3. `phrases` が非空の配列（ERROR）
4. `langs` / `scenes` / `tags` が非空のオブジェクト（ERROR）

**`langs` ブロック**
5. キーが `/^[a-z]{2}(-[A-Z]{2})?$/`（ERROR）
6. 各エントリに `label`（非空文字列）/ `gradable`（真偽）/ `hasKana`（真偽）/ `status ∈ {ready, draft}`（ERROR）
7. `default: true` がちょうど1つで、それが `gradable: true` かつ `status: "ready"`（ERROR）
8. `speech.prefer` が非空配列、`speech.accept` が配列、`speech.warn` が文字列か `null`（ERROR）
9. 同じロケールが `prefer` と `accept` の両方にある（WARN）
10. `gradable: false` の言語に `hasKana: true`（WARN。表示専用の言語のカナは死に荷物）

**`scenes` / `tags` ブロック**
11. 各値が非空文字列（ERROR）
12. 宣言済みだが1件も使われていない `scene` / `tag`（WARN）

**フレーズごと**
13. `id` が `/^[a-z0-9]+(-[a-z0-9]+)*$/`。`audio/{lang}/{id}.mp3` のファイル名として安全なことも同時に保証（ERROR）
14. `id` が一意。重複は両方の配列位置を出す（ERROR）
15. `scene` が `envelope.scenes` のキー（ERROR）
16. `week` が正の整数（ERROR）
17. `week` が配列を通じて非減少（**WARN、ERRORにしない**）。
    スイープ中に week 1 のフレーズを末尾に足すのは*正しい*操作であり、ビルドを失敗させてはならない。
    「週順」と「末尾追記のみ」は本当に衝突するが、末尾追記のほうが優先される
18. `jp` が非空文字列（ERROR）
19. `tags` が文字列配列で、すべて `envelope.tags` のキー、重複なし（ERROR）
20. **旧形式のトップレベルフィールド `pt` / `it` / `kana` / `note` が残っている**（ERROR。
    移行しそこねたフレーズは描画側に無視されて静かに壊れる）
21. `langs` があり、そのキーが `envelope.langs` のキーの部分集合（ERROR）
22. `status: "ready"` の言語について、サブオブジェクトが存在し `text` が非空（ERROR）
23. `status: "draft"` の言語について同上（WARN。言語ごとの充足率表を出す。例
    `es: 12/150 text, 4/150 kana`）
24. `hasKana` の言語で `kana` が非空（ready は ERROR、draft は WARN）。
    かつ `/^[゠-ヿ、ー\s/]+$/`（カタカナ＋`、`＋`ー`＋空白＋`/`）に一致（ERROR。
    現行150件の pt はすべて通ることを確認済み）
25. `hasKana: false`（= `en`）に `kana` があってはならない（ERROR）
26. `langs[L]` の中に `text` / `kana` / `note` 以外のキー（WARN）

**本文の衛生**
27. `text` に前後の空白・連続空白が無い（ERROR）
28. `text` に全角括弧 `（）` と `※` が無い（ERROR。注記は `note` に置く。
    これが `Grazie（同源ではない）` の再発を止めるルール）
29. `fragment` タグでない限り、`text` が `.` `?` `!` `…` で終わる（WARN）
30. `fragment` タグでない限り、`text` が大文字で始まる（WARN）
31. `fragment` タグでない限り、`text` に `/` を含まない（WARN。3.5の人手判断リストがそのまま出る）
32. **言語間の疑問符の一致**: `gradable` かつ本文が非空の言語すべてで
    `text.endsWith('?')` が一致すること（ERROR。現行150件で違反ゼロなので無料で導入でき、
    疑問文の訳し間違いを即座に捕まえられる）
33. 同じ言語で本文が完全に重複するフレーズ（WARN。現行 pt / it とも0件）
34. `jp` が重複するフレーズ（WARN）

**容量とカリキュラム**
35. `phrases.length > 250` → **ERROR**:
    `スイープ期の網羅が保証できない（10日 × 25枚 = 250枚が上限）`
36. `phrases.length > 200` → WARN: `弱点カードの2〜3回目を配る余地が無くなる`
37. レポート: 総数 / シーン別 / 週別 / 言語別の充足率表 / `スイープ ${Math.ceil(n/10)}枚/日`。
    データを編集するとスケジュールへの影響が同じ出力で見える

**他ファイルとの突き合わせ**（ファイルが無ければスキップ）
38. `data/audio-manifest.json` が平坦な配列なら旧形式として WARN。
    オブジェクトなら全キーが宣言済み言語で、全idが `phrases` に存在すること（未知idは ERROR）
39. 言語別のMP3被覆率を報告（`pt: 150/150, it: 0/150`）

**並び変更の検出**
40. `git` が使えて `git show HEAD:data/phrases.json` がパースできるとき、id列を比較する。
    既存idの位置が動いていたら
    `INFO: 既存フレーズの並びが N件動いた。スイープ期間中は末尾への追記だけにする` と出す。
    ビルドは失敗させない（学習期の並べ替えは無害なので）。git チェックアウト外では黙ってスキップ

**自己テスト**: `--self-test` フラグで、不正なフィクスチャに対して各検証を走らせる。
検証ツール専用のテストファイルは作らない。

### 8.2 `tools/test-srs.mjs` の更新

**v2 のフレーズファイル自体は既存テストを1件も壊さない。**
ファイルは `{version, phrases:[{id, …}]}` という形と配列順を保ち、
テストは言語フィールドを一切読まないからである。
壊れるのは**意図的なシグネチャ変更に伴う4箇所**だけ。

| 行 | テスト名 | 壊れる理由 | 直し方 |
|---|---|---|---|
| `:201` | 今日さわったカードだけを、間違えたものから順に返す | `buildReplay` に `allPhrases` が要る。id `a`〜`e` は孤立扱いになる | `fakePhrases(['a','b','c','d','e'])` を渡す |
| `:207` | 何もしていない日は再挑戦リストが空 | 同上 | `[]` を渡す |
| `:218` | 再挑戦リストは30枚で打ち切る | 同上。id `c0`〜`c39` | `fakePhrases(ids)` を渡す |
| `:310` | 学習期は復習30枚で打ち切り、超過を報告する | カード `c0`〜`c44` が実150件に対して孤立扱いになり `reviewIds` が0になる | 45枚を `phrases.slice(0,45).map(p => p.id)` から作る |

加えて `:526`（2本目の45日シミュレーション内の `buildReplay`）に第3引数が要る。これは assertion ではない。

それ以外はすべて無改変で通る。スイープ関連（`orderedIds` を明示的に渡している）、
2本のシミュレーション（`s.newIds` の実idを使う）、`nextState` 系のすべて。

「srs.js はフレーズから `.id` しか読まない」という不変条件を根拠に、共有ヘルパを1つ足す。

```js
const fakePhrases = (ids) => ids.map((id) => ({ id }));
```

**追加するテスト**

除外（必要なし）:
1. 除外したカードは復習に出ない
2. 除外したカードは新規として再投入されない
3. 未投入のフレーズを除外すると当日の新規枠を1つ使う
4. 除外したカードはスイープの割り当てに入らない
5. 除外したカードは再挑戦リストに出ない
6. 除外しても箱・lapses・due は保存される
7. 採点済みカードの除外を解除すると元の箱で復習に戻る
8. 未採点カードの除外を解除すると新規として投入し直される
9. 除外を解除した日は昇格しない（投入日扱い）
10. 除外は定着の分母と分子の両方から外れる
11. 全件除外しても `retentionStats` が壊れない（`total` 0）
12. スイープ中に解除したカードは解除日以降に必ず出題される
13. スイープ中の解除は割り当てを未来にしか動かさない

孤立カード:
14. phrases.json から消えたフレーズのカードは復習に出ない
15. 消えたフレーズのカードは再挑戦リストに出ない
16. 消えたフレーズのカードは定着の分母にも分子にも入らない
17. `buildSession` が返すIDは必ず phrases.json に存在する（45日通しで全出力idを検証）
18. `orphanIds` が消えたフレーズのIDだけを返す

スイープの並び凍結:
19. 凍結した並びは末尾への追記で既存の割り当てを動かさない
20. 凍結した並びは途中挿入でも既存の割り当てを動かさない
21. 凍結しない場合は途中挿入で割り当てがずれる（なぜ凍結が要るかを回帰として固定する）
22. 凍結した並びから要素を消しても他カードの割り当ては動かない
23. スイープ中に除外しても他カードの割り当ては動かない
24. `resolveSweepOrder` は凍結配列の要素順を保存する

容量:
25. カード数が250枚を超えるとスイープの網羅が崩れる（5.5の崖を明示的に固定し、
    本番で驚いて発見することを防ぐ）
26. 200枚でもスイープの網羅と `SWEEP_CAP` を両立する

45日通し（拡張）:
27. 20枚を必要なしにしても残り130枚がスイープで全部出る
28. 必要なしを付けても1日の出題枚数は35枚以下のまま

### 8.3 `tools/test-store.mjs`（新規）

`js/store.js` は `localStorage` と `JSON` しか使わず DOM に触らないので、
動的 import の前にシムを置けばテストできる。

```js
globalThis.localStorage = (() => {
  let m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => void (m = new Map()),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
  };
})();
const store = await import('../js/store.js');
```

移行:
29. 旧データ `pt.cards` が `poly.progress.pt` に移る
30. 移行は2回目以降なにもしない（冪等）
31. 移行後も `pt.cards` / `pt.meta` / `pt.trip` は残る
32. `poly.progress` が既にあれば移行しない
33. `poly.progress` が空オブジェクトでも移行は再実行されない
34. 旧データが無い新規利用者では空の器だけ作る
35. `pt.cards` が壊れていても起動を止めない
36. `pt.trip` が `poly.trips.pt` に移る
37. 旧 meta のストリークが引き継がれる
38. `modeOverride` は移行で捨てられる
39. `force` 指定なら `pt` スロットを旧データで置き換える

分離:
40. `saveProgress(lang)` は他言語の進捗を書き換えない
41. `resetProgress(lang)` は他言語とストリークを消さない
42. `resetAll` は `poly.*` だけ消し `pt.*` を残す

入出力:
43. version 2 のJSONを読み込むと `pt` に入り、`es` / `it` は残る
44. version 3 のJSONを往復できる
45. version 3 の読み込みはファイルに無い言語を消さない
46. 壊れたJSONの読み込みは1バイトも書き込まない
47. `sweepOrder` は書き出しと読み込みで往復する
48. `importJSON` は未知のキーを取り込まない（`modeOverride` 混入の防止）
49. 保存に失敗したとき `saveCard` が `false` を返す（`setItem` が投げるシムで検証）

---

## 9. 実装フェーズ

各段階の終わりでコミットでき、途中で止めてもアプリが壊れない順序にする。

| # | 内容 | 完了条件 |
|---|---|---|
| **1** | データ整備 | `tools/migrate-phrases.mjs` を書き、`data/phrases.v2.json` を生成。`it` の `/` 6件を人手で解決。`it` のカナ150件、`es` の text/kana/note 150件、`en` の text 150件を作成。`tools/check-phrases.mjs` を書き、全件 ERROR ゼロ。`git mv` で本体に昇格 |
| **2** | ストア | `js/store.js` を v2 に置き換え、`tools/test-store.mjs` が全件成功。`migrateLegacy()` を `main()` の先頭で呼ぶ |
| **3** | SRS | `js/srs.js` に 5.2 / 5.3 の変更を入れ、`tools/test-srs.mjs` が既存46件＋追加28件で成功 |
| **4** | 画面 | `index.html` / `css/style.css` / `js/app.js` を6章に沿って改修。`APP_VERSION` を上げる。README の手動確認手順を更新して実機で通す |
| **5** | 音声 | `js/audio.js` を7章に沿って再設計。言語ごとの音声診断を設定画面で確認 |

**フェーズ1は `status: "draft"` で分割できる。** `es` を空のまま `draft` にしておけば、
pt と it が動く状態でフェーズ2以降へ進める。`es` の150件が揃った時点で `"ready"` に変える
1語のコミットで有効化する。

**フェーズ4の注意**: `APP_VERSION`（`js/app.js:6`）を必ず上げる。この改修は
`#card-pt` / `#card-kana` の改名と `#card-it` / `#card-note` の削除を含むので、
キャッシュに残った旧 `app.js` は README:38-39 が記録している
`Cannot read properties of null (reading 'addEventListener')` をそのまま起こす。

---

## 10. リスクと対策

静かに壊れる順に並べる。

**R1. 保存失敗が握り潰され、進捗が無音で消える。**
`js/store.js:27-35` は例外を捕まえて `console.error` して `false` を返すが、
`js/app.js:206, 219` は戻り値を見ていない。iOS の PWA でストレージ上限に達すると、
採点はすべて成功したように見えて何も保存されない。データが3倍になるぶん到達しやすくなる
（とはいえ 3×150枚で約63KB、5MBの枠には遠い）。
→ `saveCard` / `saveProgress` の真偽値を上位へ伝える。`false` なら
「保存できていません。設定からJSONを書き出してください」の常設バナーを出し、
**採点ボタンを無効化**する。虚空に入力を受け付け続けるより止めるほうがよい。テスト49で固定。

**R2. id の再利用で死んだカードが蘇る。**
`rest-07` を消し、後日まったく別のフレーズに同じidを付けると、古い箱・lapses・
そして最悪の場合 `suspended: true` を継承する。利用者が一度も見ていないフレーズが
永久に除外され、定着カウンタは箱5として数える。画面のどこにも異常が出ない。
→ (a) 「idは恒久・再利用禁止」を README のフレーズ追加手順の隣に明記、
(b) 設定画面に「孤立した進捗 N件」を id 付きで出し、明示的な削除ボタンを添える
（死んだレコードが潜まず、見える）、
(c) 追記専用の `data/id-history.json` をコミットし、`check-phrases.mjs` が
「コミット済みの履歴にあるのに現行ファイルに無いidが再登場した」場合を ERROR にする。
実効的な防御は (c) だけで、(a)(b) は安価な代替である。

**R3. スイープ中のフレーズ編集で網羅保証が壊れる。**
5.4で分析したとおり、途中挿入で約15枚がどこにもエラーを出さずに消える。
→ 4段構えで守る: `sweepOrder` の凍結（構造）、末尾追記のみの規約（編集）、
`check-phrases.mjs` の並び変更検出（助言）、テスト19〜24（回帰）。
これは見えない失敗であり、アプリの中心的な約束がここに懸かっているので4つとも入れる。

**R4. 250枚の崖。**
`js/srs.js:244` が base エントリまで切り捨て始めるが、何の警告も出ない。
251枚目でアプリは「出発時点で全カードを1周させる」という設計目的を静かに放棄する。
→ `check-phrases.mjs` で 250超 ERROR / 200超 WARN。テスト25で崖の位置を固定。
README に `SWEEP_DAYS × SWEEP_CAP` の算術を書く。

**R5. キャッシュに残った旧 `app.js` が移行後も旧キーへ書き続ける。**
README は既にキャッシュ由来の不具合を既知の失敗モードとして記録している。
旧ビルドを開いたままのタブは、もう誰も読まない `pt.cards` に書き続ける。
利用者はエラーを1つも見ずに数日分の進捗を失う。
→ `APP_VERSION` を上げる。旧キーは消さない。起動時に
`pt.meta.lastDone > poly.meta.lastDone` なら設定画面に「旧形式のデータの方が新しい」と出し、
「旧データから取り込み直す」（`migrateLegacy({force:true})`、
「ptの進捗を置き換えます」と明示した確認つき）を隣に置く。

**R6. 全言語一括の書き戻しで、ある言語の進捗が別の言語に潰される。**
`loadAllProgress()` の結果をアプリ状態に持ったまま主言語を切り替え、あとで書き戻すと起きる。
→ `saveProgress` / `saveCard` が store.js の内部で必ず read-modify-write する。
**「全部保存する関数」を export しない。** アプリ状態は現在の言語ぶんだけを持つ。テスト40で固定。

**R7. 部分的なインポートで複数言語が同時に壊れる。**
切り詰められた、あるいは手編集された v3 ファイルが pt では通り es で落ちると、
pt が置き換わった状態で es が中途半端に書かれる。
→ `importJSON` は全スロットを検証してから書く。`poly.progress` への書き込みをコミット点とする。テスト46。

**R8. `retentionStats` のゼロ除算。**
`js/app.js:87` は `retained / state.phrases.length` を無防備に計算している。
除外を入れると分母は `total` になり、全フレーズを除外すると0に達して進捗バーの幅が `NaN%` になる。
→ 呼び出し側で `total ? retained / total : 0`。テスト11。

**R9. `settings.primary` が `gradable` でない、あるいは `draft` の言語を指す。**
手編集した localStorage、将来のビルドが書き出したファイル、あるいは単なるバグで `en` が
選ばれると、`p.langs[primary].text` が描画中に例外を投げる。
→ 起動時に `primary` を `data.langs` に対して検証する（存在する / `gradable: true` /
`status: "ready"`）。外れていたら `default: true` の言語に落として設定を書き直す。
加えて `textOf(p, lang)` が `''` を返す防御を置く。

**R10. 「必要なし」は取り消しのない破壊的なタップである。**
だめ／あいまい／できたの隣にあり、押すとカードがすべてのリストから消える。
→ 6.7の2段確認（同じ枠での入れ替え、350msのタップ貫通防止、5秒で自動復帰）。
`suspendedOn` があるので完了画面に「今日『必要なし』にした N枚」とワンタップの取り消しを出せる。
恒久的な戻り道は設定画面の除外リスト。データモデルは完全に可逆であり、
UI がそれを裏切らないようにする。

**R11. 孤立した進捗が無自覚に溜まる。**
削除したフレーズの記録は意図的に残す（決定9）ため、同時に見えなくなる。
書き出しファイルが膨らんでも理由が誰にも分からない。
→ `orphanIds()` と設定画面の「孤立した進捗 N件」＋明示的な削除。
**自動削除はしない**（誤って消したフレーズを戻したら進捗も戻る必要がある）。

**R12. 言語別の出発日が切替の摩擦になる。**
出発日の無い言語に切り替えたときセットアップ画面に落とすと、データが消えたように見える。
→ 6.12のとおりセットアップ画面へは飛ばさない。設定画面に留まり、該当欄へフォーカスする。
さらに、他の言語に旅程があるときは「ポルトガル語と同じ出発日を使う」のワンタップ補完を出す。

**R13. `version` という名前の数値が2系統ある。**
`phrases.json` は 2 に、書き出し envelope は 3 に上がる。
→ 両ファイルに `kind` 識別子（`"phrases"` / `"polyglot-trainer-progress"`）を入れ、
`version` より先に判定する。README に2つのバージョン空間の対応表を置く。

**R14. `es` が中途半端なまま `ready` になる。**
150件中12件しか埋まっていない `es` を `ready` にすると、解答が空欄で表示され、無音が再生される。
→ `status: "draft"` によるアプリ側のゲートと、`check-phrases.mjs` の充足率表。
`"ready"` への変更は意図的な1語のコミットであり、その瞬間からすべての空欄が ERROR になる。

---

## 11. スコープ外

本仕様には含めない。既存の Phase 分けと同じ扱いで、必要になったら別途仕様を起こす。

- **旅行モードの画面**（`modeFor()` が `trip` を返したときの実戦フレーズブック）。
  フォーク元の Phase 3 のまま未実装で、多言語化とは独立している
- **Service Worker とオフライン動作**（フォーク元の Phase 3）
- **UI 自体の多言語化**。画面の日本語は固定する。可変になるのは学習**対象**の言語だけ
- **Cloud TTS による MP3 の一括生成**（`tools/gen_audio.py`）。
  パス設計（`audio/{lang}/{id}.mp3`）とマニフェスト形式だけを7.4で決めておく
- **4言語目以降の追加**。3.1の構造はデータ編集だけで足せるようにしてあるが、
  実際に足す作業は本仕様の対象外
- **フレーズ内容の拡充**。150件のまま3言語に広げることだけを扱う
- **端末間の同期**。書き出し / 読み込みによる手動移送のみ（現行と同じ）

---

## 付録: 変更されるファイルの一覧

| ファイル | 変更 |
|---|---|
| `data/phrases.json` | v2 構造へ。envelope に `langs` / `scenes` / `tags`、フレーズに `langs` |
| `js/store.js` | 全面改修。`poly.*` キー、言語別の read-modify-write、`migrateLegacy()`、書き出しv3 / 読み込みv2+v3 |
| `js/srs.js` | `activeCards` / `suspend` / `unsuspend` / `retentionStats` / `orphanIds` / `resolveSweepOrder` を追加。`buildSession`（`:230`）/ `buildReplay`（`:277`）/ `sweepPlan`（`:173`）/ `isRetained`（`:136`）を変更 |
| `js/audio.js` | 全面改修。`speak(phrase, lang, rate)`、言語別のボイス解決をデータから、`audio/{lang}/{id}.mp3` |
| `js/app.js` | 上記すべての利用側。`SCENE_LABELS`（`:8-19`）をデータへ移す。`APP_VERSION`（`:6`）を上げる |
| `index.html` | セッションカードの再構成、必要なし行、ホームの言語表示、設定画面の全面拡張 |
| `css/style.css` | `--skip` 系トークン、参照言語のスタック、必要なし行、言語スイッチャー、除外リスト、`.ghost` の44px |
| `tools/migrate-phrases.mjs` | 新規（一度きり） |
| `tools/check-phrases.mjs` | 新規 |
| `tools/test-store.mjs` | 新規 |
| `tools/test-srs.mjs` | 4箇所の修正（`:201` `:207` `:218` `:310`）＋ `:526` の引数追加＋約28件の追加 |
| `.gitignore` | `audio/*.mp3` → `audio/**/*.mp3` |
| `README.md` | 全面更新（別途） |
