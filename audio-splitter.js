/**
 * audio-splitter.js
 * ブラウザ上で動作する完全ローカルの音声デコード＆WAV切り出しエンジン
 * 
 * [役割]
 * 音声ファイルのロード（デコード）と、指定区間の切り出し（WAV Blob生成）のみを担当。
 * UI操作や状態管理は、HTML（テンプレート側）に委ねることで疎結合を保ちます。
 */

class AudioSplitter {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.audioBuffer = null;
  }

  /**
   * 音声ファイルをデコードしてバッファに格納する
   * @param {File} file - input要素から取得したファイルオブジェクト
   * @returns {Promise<number>} デコードされた音声の総長さ（秒数）
   */
  async loadFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    // ブラウザ内蔵のデコーダーでデコード（M4A, MP3, WAVに対応）
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    return this.audioBuffer.duration;
  }

  /**
   * 指定範囲を切り出してWAV（Blob）を生成する
   * @param {number} startTime - 開始時間（秒）
   * @param {number} endTime - 終了時間（秒）
   * @returns {Blob} WAV形式のBlobデータ
   */
  split(startTime, endTime) {
    if (!this.audioBuffer) {
      throw new Error("音声ファイルが読み込まれていません。");
    }

    const sampleRate = this.audioBuffer.sampleRate;
    const numberOfChannels = this.audioBuffer.numberOfChannels;
    
    // 秒数をサンプルインデックスに変換
    const startOffset = Math.max(0, Math.floor(startTime * sampleRate));
    const endOffset = Math.min(this.audioBuffer.length, Math.floor(endTime * sampleRate));
    const frameLength = endOffset - startOffset;

    if (frameLength <= 0) {
      throw new Error("開始位置と終了位置の設定が正しくありません。");
    }

    // 切り出しバッファを生成してデータをコピー
    const newBuffer = this.audioContext.createBuffer(numberOfChannels, frameLength, sampleRate);
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = this.audioBuffer.getChannelData(channel);
      const subData = channelData.subarray(startOffset, endOffset);
      newBuffer.copyToChannel(subData, channel);
    }

    return this.bufferToWavBlob(newBuffer);
  }

  /**
   * AudioBufferを16bit PCM WAVフォーマットのBlobに変換する（内部メソッド）
   */
  bufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const lclSampleRate = buffer.sampleRate;
    const format = 1; // LPCM
    const bitDepth = 16;
    
    let result;
    if (numOfChan === 2) {
      result = this.interleave(buffer.getChannelData(0), buffer.getChannelData(1));
    } else {
      result = buffer.getChannelData(0);
    }
    
    const bufferLength = result.length;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numOfChan * bytesPerSample;
    
    const arrayBuffer = new ArrayBuffer(44 + bufferLength * bytesPerSample);
    const view = new DataView(arrayBuffer);
    
    // RIFF ヘッダ書き込み
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + bufferLength * bytesPerSample, true);
    this.writeString(view, 8, 'WAVE');
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, lclSampleRate, true);
    view.setUint32(28, lclSampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    this.writeString(view, 36, 'data');
    view.setUint32(40, bufferLength * bytesPerSample, true);
    
    // Float32の音声波形データを16bit整数に変換して書き込み
    let offset = 44;
    for (let i = 0; i < bufferLength; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, result[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    
    return new Blob([view], { type: 'audio/wav' });
  }

  // ステレオ左右を交互に結合
  interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    
    while (index < length) {
      result[index++] = inputL[inputIndex];
      result[index++] = inputR[inputIndex];
      inputIndex++;
    }
    return result;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}