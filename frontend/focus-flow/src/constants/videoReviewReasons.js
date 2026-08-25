export const REJECTION_REASONS = [
  {
    code: 'contentIncorrect',
    label: '內容不正確',
    placeholder: '請說明哪個段落或知識點有誤，例如：第 12 秒提到的公式錯誤',
  },
  {
    code: 'audioIssue',
    label: '聲音問題',
    placeholder: '請說明是雜音、語速異常、配音不同步，還是其他聲音問題',
  },
  {
    code: 'visualQuality',
    label: '畫面品質問題',
    placeholder: '請說明是畫質模糊、AI 生成畫面扭曲，還是其他視覺問題',
  },
  {
    code: 'subtitleIssue',
    label: '字幕問題',
    placeholder: '請說明是字幕缺漏、不同步，還是錯字，並標註約略時間點',
  },
  {
    code: 'incomplete',
    label: '內容不完整',
    placeholder: '請說明影片在哪裡被截斷或缺少哪個段落',
  },
  {
    code: 'other',
    label: '其他',
    placeholder: '請說明其他不通過的原因（必填）',
    required: true,
  },
];
