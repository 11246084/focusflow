// PoC wording only: this is not a statement of legal sufficiency.
const TERMS_VERSION = 'recut-poc-2026-11-01-v1';
const KINDS = Object.freeze(['content', 'voice', 'avatarLikeness', 'voiceClone']);
const TERMS = Object.freeze({
  version: TERMS_VERSION,
  title: 'FocusFlow 教師授課內容與短片使用同意（PoC）',
  notice: '這是校內概念驗證版條款，不代表已完成法律審查或保證足以涵蓋所有使用情境。試跑教授影片另以書面同意為依據，由團隊明確補登。',
  content: '上傳前，請確認您有權提供這份授課內容，並同意系統處理影片、產生逐字稿與向量資料供教學問答，也可剪輯或改寫授課內容製作短片。短片須經教師審閱，可上傳系統共用 YouTube 帳號，設為不公開連結，並提供學生短片牆觀看；持有連結者仍可能轉傳。不同意時不能上傳。此項不包含使用您的原音、肖像或聲音複製。',
  voice: '生成 recut 時，您可選擇使用自己的授課原音，或選擇不使用原音的合成語音版。系統第一次詢問後記住您的選擇，之後會顯示並允許改選。合成語音版可能改寫授課內容為旁白，片中標示「AI 合成語音」；未就緒時會明確告知，不會改用您的原音。',
  avatarLikeness: '數位分身另外需要您的肖像使用同意，影像由地端模型處理。這與授課內容同意、原音選擇及聲音複製同意分開記錄；不同意時不能選擇需要您肖像的產片方式。',
  voiceClone: '數位分身的聲音複製另行取得同意，聲音複製由地端模型處理。提供授課影片或同意使用原音，不代表同意複製聲音。',
  processing: 'recut 的選段、文字與圖卡檢查會把必要授課內容交給外部 Gemini 服務處理。合成語音採本機 Kokoro 模型與 sherpa-onnx 執行，不把合成語音文字送到外部語音服務，不需您的參考音。',
  withdrawal: '您可改選或撤回同意，系統保留誰在何時同意或撤回哪版條款的紀錄。撤回後禁止需要該同意的新工作，並停止處理中的工作。已完成短片列出供您逐支勾選或全選，預設不勾選；選中的短片從學生短片牆移除、未上架工作取消，系統盡力將 YouTube 影片轉私人。失敗時每位管理員會收到通知，並保留待手動下架項目。已被他人下載或轉傳的影片無法收回。',
});
module.exports = { TERMS_VERSION, TERMS, KINDS };
