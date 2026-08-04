// 音声の抽象化。呼び出し側は speak(phrase) だけを使う。
//   1. audio/{id}.mp3 があれば再生（Phase 3でGoogle Cloud TTSから生成）
//   2. なければブラウザ内蔵TTSで lang='pt-PT'
// ブラジル音声(pt-BR)で代用すると発音を誤学習するため、pt-PT音声が無い端末では警告を出す。

const MANIFEST_URL = 'data/audio-manifest.json';
const AUDIO_DIR = 'audio/';

let mp3Set = null;       // Set<string> | null（nullならMP3未導入）
let voice = null;        // SpeechSynthesisVoice | null
let voiceStatus = 'unknown'; // 'ptpt' | 'ptbr' | 'none' | 'unsupported'
let voicesLoaded = false;    // getVoices() が中身を返したか
let current = null;      // 再生中のHTMLAudioElement

const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

function normLang(l) {
  return (l || '').replace('_', '-');
}

function pickVoice() {
  if (!synth) {
    voiceStatus = 'unsupported';
    return;
  }
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return; // まだ読み込まれていない
  voicesLoaded = true;

  const ptPT = voices.find((v) => normLang(v.lang) === 'pt-PT');
  if (ptPT) {
    voice = ptPT;
    voiceStatus = 'ptpt';
    return;
  }
  const ptAny = voices.find((v) => normLang(v.lang).startsWith('pt'));
  if (ptAny) {
    voice = ptAny;
    voiceStatus = 'ptbr';
    return;
  }
  voice = null;
  voiceStatus = 'none';
}

/** 起動時に一度呼ぶ */
export async function init() {
  if (synth) {
    pickVoice();
    // Chrome系はgetVoices()が非同期。イベントで取り直す
    if (!voicesLoaded) {
      synth.addEventListener?.('voiceschanged', pickVoice);
      // Safariは即座に返るがイベントが来ないことがあるので保険で数回試す
      for (let i = 0; i < 10 && !voicesLoaded; i++) {
        await new Promise((r) => setTimeout(r, 100));
        pickVoice();
      }
      if (!voicesLoaded) voiceStatus = 'none';
    }
  } else {
    voiceStatus = 'unsupported';
  }

  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) mp3Set = new Set(list);
    }
  } catch (e) {
    // MP3未導入。内蔵TTSで動かす
    mp3Set = null;
  }

  return status();
}

export function status() {
  return {
    voiceStatus,
    voiceName: voice ? voice.name : null,
    mp3Count: mp3Set ? mp3Set.size : 0,
  };
}

/** pt-PT音声が使えない状態か */
export function needsWarning() {
  return !mp3Set && voiceStatus !== 'ptpt';
}

export function warningText() {
  if (mp3Set) return null;
  if (voiceStatus === 'ptpt') return null;
  if (voiceStatus === 'unknown') return null; // 判定前は何も出さない
  if (voiceStatus === 'ptbr') {
    return 'この端末にヨーロッパポルトガル語の音声がありません。ブラジル音声で代用中のため発音が実際と異なります。設定 → 音声 から確認してください。';
  }
  if (voiceStatus === 'none') {
    return 'この端末にポルトガル語の音声がありません。音声なしで学習できますが、カナ表記を頼りにしてください。';
  }
  return 'この端末は音声合成に対応していません。カナ表記を頼りにしてください。';
}

export function stop() {
  if (current) {
    current.pause();
    current = null;
  }
  synth?.cancel();
}

/**
 * フレーズを読み上げる。rate は 1.0 か 0.75 を想定。
 * @param {{id:string, pt:string}} phrase
 */
export function speak(phrase, rate = 1.0) {
  stop();

  if (mp3Set && mp3Set.has(phrase.id)) {
    const el = new Audio(`${AUDIO_DIR}${phrase.id}.mp3`);
    el.playbackRate = rate;
    current = el;
    el.play().catch((e) => console.warn('MP3の再生に失敗', e));
    return;
  }

  if (!synth || voiceStatus === 'none' || voiceStatus === 'unsupported') return;

  const u = new SpeechSynthesisUtterance(phrase.pt);
  u.lang = 'pt-PT';
  if (voice) u.voice = voice;
  u.rate = rate;
  synth.speak(u);
}

/** 端末で使えるポルトガル語音声の一覧（設定画面の表示用） */
export function listPortugueseVoices() {
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((v) => normLang(v.lang).startsWith('pt'))
    .map((v) => `${v.name} / ${normLang(v.lang)}`);
}
