// 音声の抽象化。呼び出し側は speak(phrase, lang) だけを使う。
//   1. audio/{lang}/{id}.mp3 があれば再生
//   2. なければブラウザ内蔵TTSで、その言語に解決したボイスで読み上げる
//
// 言語ごとの設定（prefer / accept / warn）は data/phrases.json の langs[L].speech から
// 受け取る。コードには言語コードを持たない。4言語目を足す作業がデータ編集だけで
// 済むのはこの性質のおかげ。
//
// 地域違いの音声で代用すると発音を誤学習するため、prefer に一致しない場合は警告を出す。
// ただし警告は主言語についてのみ。参考として並ぶ言語がどの方言で読まれても学習は損なわれない。
//
// 詳細は docs/SPEC-multilingual.md の 7章。

const MANIFEST_URL = 'data/audio-manifest.json';
const AUDIO_DIR = 'audio/';

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

let langs = {};          // { [lang]: { label, speech: {prefer, accept, warn} } }
let resolved = {};       // { [lang]: { voice, locale, state: 'ready'|'fallback'|'none' } }
let mp3Sets = {};        // { [lang]: Set<string> }
let primary = null;      // 主言語。警告の対象
let voicesLoaded = false;
let unsupported = !synth;
let current = null;      // 再生中のHTMLAudioElement

function normLang(l) {
  return (l || '').replace('_', '-');
}

function prefixOf(lang) {
  return lang.split('-')[0];
}

function speechOf(lang) {
  const s = (langs[lang] || {}).speech || {};
  return {
    prefer: Array.isArray(s.prefer) ? s.prefer : [],
    accept: Array.isArray(s.accept) ? s.accept : [],
    warn: s.warn === undefined ? null : s.warn,
  };
}

/**
 * その言語のボイスを1つ選ぶ。
 * prefer に完全一致 → localService（オフラインで使える）→ default の降順で先頭を採る。
 */
function resolveOne(lang, voices) {
  const { prefer } = speechOf(lang);
  const pre = prefixOf(lang);
  const cand = voices.filter((v) => normLang(v.lang).startsWith(pre));
  if (cand.length === 0) return { voice: null, locale: prefer[0] || lang, state: 'none' };

  const score = (v) => {
    const loc = normLang(v.lang);
    const exact = prefer.includes(loc) ? 1 : 0;
    return [exact, v.localService ? 1 : 0, v.default ? 1 : 0];
  };
  cand.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sb[i] !== sa[i]) return sb[i] - sa[i];
    return 0;
  });

  const voice = cand[0];
  const locale = normLang(voice.lang);
  return { voice, locale, state: prefer.includes(locale) ? 'ready' : 'fallback' };
}

function resolveAll() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return;   // まだ読み込まれていない
  voicesLoaded = true;
  for (const lang of Object.keys(langs)) resolved[lang] = resolveOne(lang, voices);
}

/**
 * 起動時に一度呼ぶ。
 * @param {object} langsConfig data/phrases.json の langs ブロック
 * @param {string} primaryLang 主言語
 */
export async function init(langsConfig, primaryLang) {
  langs = langsConfig || {};
  primary = primaryLang || null;
  resolved = {};
  for (const lang of Object.keys(langs)) {
    resolved[lang] = { voice: null, locale: speechOf(lang).prefer[0] || lang, state: 'none' };
    mp3Sets[lang] = new Set();
  }

  if (synth) {
    resolveAll();
    // Chrome系は getVoices() が非同期。イベントで取り直す
    if (!voicesLoaded) {
      synth.addEventListener?.('voiceschanged', resolveAll);
      // Safariは即座に返るがイベントが来ないことがあるので保険で数回試す。
      // 再試行のたびに全言語ぶんを解決し直す
      for (let i = 0; i < 10 && !voicesLoaded; i++) {
        await new Promise((r) => setTimeout(r, 100));
        resolveAll();
      }
    }
  } else {
    unsupported = true;
  }

  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (res.ok) {
      const m = await res.json();
      // 旧形式（平坦な配列）は pt のものとして扱う
      const byLang = Array.isArray(m) ? { pt: m } : (m && m.byLang) || {};
      for (const [lang, ids] of Object.entries(byLang)) {
        if (Array.isArray(ids)) mp3Sets[lang] = new Set(ids);
      }
    }
  } catch (e) {
    // MP3未導入。内蔵TTSで動かす
  }

  return statusAll();
}

/** 主言語を切り替える。音声解決は init で済んでいるのでポインタ更新だけ。同期・即時 */
export function setPrimary(lang) {
  stop();
  primary = lang;
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
  }
  synth?.cancel();
}

/** その言語で何か鳴らせるか。false なら再生ボタンを disabled にする */
export function isAvailable(lang) {
  if (mp3Sets[lang] && mp3Sets[lang].size > 0) return true;
  const r = resolved[lang];
  return !!(r && r.voice);
}

/**
 * フレーズを読み上げる。rate は 1.0 か 0.75 を想定。
 * @param {{id:string, langs:object}} phrase フレーズのレコード全体
 * @param {string} lang 読み上げる言語
 */
export function speak(phrase, lang, rate = 1.0) {
  stop();
  if (!phrase || !lang) return;

  const set = mp3Sets[lang];
  if (set && set.has(phrase.id)) {
    const el = new Audio(`${AUDIO_DIR}${lang}/${phrase.id}.mp3`);
    el.playbackRate = rate;
    current = el;
    el.play().catch((e) => console.warn('MP3の再生に失敗', e));
    return;
  }

  if (!synth) return;
  const sub = (phrase.langs || {})[lang];
  const raw = sub && typeof sub.text === 'string' ? sub.text : '';
  if (!raw) return;

  // fragment の二択表記（zero / mezzo）はスラッシュを読ませない
  const text = raw.replace(/\s+\/\s+/g, ', ');

  const r = resolved[lang];
  if (!r || !r.voice) return;

  const u = new SpeechSynthesisUtterance(text);
  // 解決したボイスのロケールを宣言する。ボイスと u.lang が食い違うと
  // どちらが勝つかがエンジンによって変わり、出力が不安定になる
  u.lang = r.locale;
  u.voice = r.voice;
  u.rate = rate;
  synth.speak(u);
}

export function status(lang = primary) {
  const r = resolved[lang] || {};
  return {
    lang,
    label: (langs[lang] || {}).label || lang,
    voiceStatus: unsupported ? 'unsupported' : (voicesLoaded ? r.state : 'unknown'),
    voiceName: r.voice ? r.voice.name : null,
    voiceLocale: r.locale || null,
    mp3Count: mp3Sets[lang] ? mp3Sets[lang].size : 0,
  };
}

export function statusAll() {
  return Object.fromEntries(Object.keys(langs).map((l) => [l, status(l)]));
}

/**
 * 主言語について注意が要る状態なら文言を返す。問題なければ null。
 * MP3が入っている言語では抑止する（実音声なのでボイスの方言は関係ない）。
 */
export function warningText() {
  if (!primary) return null;
  const st = status(primary);
  if (st.mp3Count > 0) return null;
  if (st.voiceStatus === 'unknown') return null;   // 判定前は何も出さない
  if (st.voiceStatus === 'unsupported') {
    return 'この端末は音声合成に対応していません。カナ表記を頼りにしてください。';
  }
  if (st.voiceStatus === 'none') {
    return `この端末に${st.label}の音声がありません。音声なしで学習できますが、カナ表記を頼りにしてください。`;
  }
  if (st.voiceStatus === 'fallback') {
    // 方言差を許容する言語は speech.warn が null。その場合は何も出さない
    return speechOf(primary).warn;
  }
  return null;
}

/** 端末で使えるその言語の音声一覧（設定画面の表示用） */
export function listVoices(lang) {
  if (!synth) return [];
  const pre = prefixOf(lang);
  return synth
    .getVoices()
    .filter((v) => normLang(v.lang).startsWith(pre))
    .map((v) => `${v.name} / ${normLang(v.lang)}`);
}
