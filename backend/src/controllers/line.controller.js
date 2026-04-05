const lineService = require('../services/line.service');

// ── 接收 LINE Webhook 事件 ───────────────────────────────────
const handleWebhook = async (req, res) => {
  // 先回 200 給 LINE，避免 timeout
  res.status(200).json({ status: 'ok' });

  const events = req.body.events || [];

  for (const event of events) {
    try {
      const lineUserId = event.source?.userId;
      const replyToken = event.replyToken;

      // follow 事件：使用者加 Bot 為好友
      if (event.type === 'follow') {
        await lineService.handleFollow(event);
        continue;
      }

      // message 事件：使用者傳文字訊息
      if (event.type === 'message' && event.message.type === 'text') {
        const text = event.message.text.trim();

        // 判斷是否為綁定 token（64 位 hex 字串）
        if (/^[a-f0-9]{64}$/.test(text)) {
          await lineService.handleBind(lineUserId, text, replyToken);
          continue;
        }

        // 切換課程指令
        if (text === '切換課程') {
          await lineService.handleSwitchCourse(lineUserId, replyToken);
          continue;
        }

        // 其他訊息視為問題
        await lineService.handleQuestion(lineUserId, text, replyToken);
        continue;
      }

      // postback 事件：使用者點按鈕
      if (event.type === 'postback') {
        const params = new URLSearchParams(event.postback.data);
        const action = params.get('action');

        if (action === 'select_course') {
          const courseId = params.get('courseId');
          await lineService.handleSelectCourse(lineUserId, courseId, replyToken);
        }
        continue;
      }
    } catch (err) {
      console.error('[LINE] event error:', err);
    }
  }
};

// ── 產生綁定 token（網頁端呼叫）────────────────────────────
const generateBindToken = async (req, res) => {
  try {
    // 這裡假設網頁端已經登入，userId 從 JWT middleware 拿
    const userId = req.user._id;
    const token = await lineService.generateBindToken(userId);

    return res.status(200).json({
      status: 'success',
      data: { token },
    });
  } catch (err) {
    console.error('[LINE] generateBindToken error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  handleWebhook,
  generateBindToken,
};
