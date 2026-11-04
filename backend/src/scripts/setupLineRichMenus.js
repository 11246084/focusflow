const fs = require('fs');
const path = require('path');

// 用 Messaging API 建立 LINE 決策 LM 的兩張圖文選單（只在操作者明確執行時對外寫入）：
// - 未綁定：一格「連結帳號」，開啟 FocusFlow 的 LINE 提問頁；設為所有人的預設選單。
// - 已綁定：2×2 四格「切換課程、今日額度、使用說明、網頁版」；後端綁定成功時用 LINE_RICH_MENU_BOUND_ID 指定給該學生。
// 不帶 --apply 時只印出要建立的內容，不呼叫 LINE。不讀 backend/.env：權杖由操作者在指令列環境提供。
//
// 指令例：
//   npm run line:rich-menu -- --site-url https://focusflow.ntub.edu.tw
//   LINE_CHANNEL_ACCESS_TOKEN=... npm run line:rich-menu -- --site-url https://focusflow.ntub.edu.tw --apply
//   LINE_CHANNEL_ACCESS_TOKEN=... npm run line:rich-menu -- --site-url https://focusflow.ntub.edu.tw --only bound --apply
//   LINE_CHANNEL_ACCESS_TOKEN=... npm run line:rich-menu -- --delete-menu richmenu-... --apply
//   LINE_CHANNEL_ACCESS_TOKEN=... npm run line:rich-menu -- --rollback --unbound-id richmenu-... --bound-id richmenu-... --apply
const LINE_API_BASE = 'https://api.line.me/v2/bot';
const LINE_DATA_API_BASE = 'https://api-data.line.me/v2/bot';
const ASSET_DIR = path.resolve(__dirname, '../../../docs/04_Features/LINE_Binding/assets');
const MENU_SIZE = { width: 2500, height: 843 };
// 已綁定選單用 2×2 大圖（2026-11-04 百陶要求），每格 1250×843。
const BOUND_MENU_SIZE = { width: 2500, height: 1686 };
const BOUND_CELL = { width: 1250, height: 843 };
const RICH_MENU_ID_PATTERN = /^richmenu-[0-9a-f]{32}$/;

class RichMenuSetupError extends Error {}

function normalizeSiteUrl(siteUrl) {
  let url;
  try {
    url = new URL(siteUrl);
  } catch {
    throw new RichMenuSetupError('--site-url must be an absolute URL, e.g. https://focusflow.ntub.edu.tw');
  }
  if (url.protocol !== 'https:') {
    throw new RichMenuSetupError('--site-url must use https (LINE opens it from the chat).');
  }
  return url.origin;
}

function postbackArea(x, y, label, action) {
  return {
    bounds: { x, y, ...BOUND_CELL },
    // displayText 讓聊天室顯示學生按了什麼；後端只看 data，不看文字。
    action: { type: 'postback', label, data: `action=${action}`, displayText: label },
  };
}

function buildRichMenuDefinitions(siteUrl) {
  const origin = normalizeSiteUrl(siteUrl);
  return {
    unbound: {
      image: path.join(ASSET_DIR, 'rich-menu-unbound.png'),
      body: {
        size: MENU_SIZE,
        selected: true,
        name: 'FocusFlow 未綁定',
        chatBarText: '連結帳號',
        areas: [{
          bounds: { x: 0, y: 0, ...MENU_SIZE },
          action: { type: 'uri', label: '連結帳號', uri: `${origin}/app/line` },
        }],
      },
    },
    bound: {
      image: path.join(ASSET_DIR, 'rich-menu-bound-large.png'),
      body: {
        size: BOUND_MENU_SIZE,
        selected: false,
        name: 'FocusFlow 已綁定',
        chatBarText: '選單',
        areas: [
          postbackArea(0, 0, '切換課程', 'switch_course'),
          postbackArea(BOUND_CELL.width, 0, '今日額度', 'today_quota'),
          postbackArea(0, BOUND_CELL.height, '使用說明', 'help'),
          {
            bounds: { x: BOUND_CELL.width, y: BOUND_CELL.height, ...BOUND_CELL },
            action: { type: 'uri', label: '網頁版', uri: `${origin}/app` },
          },
        ],
      },
    },
  };
}

function createLineClient({ token, fetchImpl = fetch }) {
  async function request(method, url, { json, body, contentType } = {}) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      body: json ? JSON.stringify(json) : body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new RichMenuSetupError(`LINE ${method} ${new URL(url).pathname} failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const text = await response.text().catch(() => '');
    return text ? JSON.parse(text) : {};
  }

  return {
    createMenu: (body) => request('POST', `${LINE_API_BASE}/richmenu`, { json: body }),
    uploadImage: (richMenuId, image) => request('POST', `${LINE_DATA_API_BASE}/richmenu/${richMenuId}/content`, {
      body: image,
      contentType: 'image/png',
    }),
    setDefault: (richMenuId) => request('POST', `${LINE_API_BASE}/user/all/richmenu/${richMenuId}`),
    clearDefault: () => request('DELETE', `${LINE_API_BASE}/user/all/richmenu`),
    deleteMenu: (richMenuId) => request('DELETE', `${LINE_API_BASE}/richmenu/${richMenuId}`),
  };
}

// 建立兩張選單並上傳圖片，最後才把「未綁定」設為預設；中途失敗時刪掉這次建立的選單，不留半成品。
// only='bound' 時只建立「已綁定」選單、不動預設選單：換已綁定選單的版面時用，
// 「連結帳號」預設選單維持原樣。
async function createRichMenus({ client, definitions, readImage = fs.readFileSync, only = null }) {
  const keys = only ? [only] : ['unbound', 'bound'];
  const created = [];
  try {
    const ids = {};
    for (const key of keys) {
      const { richMenuId } = await client.createMenu(definitions[key].body);
      if (!RICH_MENU_ID_PATTERN.test(String(richMenuId))) {
        throw new RichMenuSetupError('LINE did not return a richMenuId.');
      }
      created.push(richMenuId);
      await client.uploadImage(richMenuId, readImage(definitions[key].image));
      ids[key] = richMenuId;
    }
    if (ids.unbound) await client.setDefault(ids.unbound);
    return ids;
  } catch (error) {
    for (const richMenuId of created) {
      await client.deleteMenu(richMenuId).catch(() => {});
    }
    throw error;
  }
}

// 退回：取消預設選單並刪除兩張選單；刪除後，已指定給學生的選單也一併失效，回到官方帳號後台的選單。
async function rollbackRichMenus({ client, unboundId, boundId }) {
  for (const id of [unboundId, boundId]) {
    if (!RICH_MENU_ID_PATTERN.test(String(id))) {
      throw new RichMenuSetupError('--unbound-id and --bound-id must be richmenu-<32 hex> ids.');
    }
  }
  await client.clearDefault();
  await client.deleteMenu(boundId);
  await client.deleteMenu(unboundId);
}

async function deleteRichMenu({ client, richMenuId }) {
  if (!RICH_MENU_ID_PATTERN.test(String(richMenuId))) {
    throw new RichMenuSetupError('--delete-menu must be a richmenu-<32 hex> id.');
  }
  await client.deleteMenu(richMenuId);
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (argv.includes('--rollback')) {
    const unboundId = readArg(argv, '--unbound-id');
    const boundId = readArg(argv, '--bound-id');
    if (!apply) {
      console.log(`Dry run: would clear the default rich menu and delete ${boundId} and ${unboundId}. Add --apply to run.`);
      return;
    }
    if (!token) throw new RichMenuSetupError('Set LINE_CHANNEL_ACCESS_TOKEN in the shell for this command.');
    await rollbackRichMenus({ client: createLineClient({ token }), unboundId, boundId });
    console.log('Rich menus removed. Clear LINE_RICH_MENU_BOUND_ID in backend/.env and restart the backend.');
    return;
  }

  if (argv.includes('--delete-menu')) {
    const richMenuId = readArg(argv, '--delete-menu');
    if (!apply) {
      console.log(`Dry run: would delete ${richMenuId}. Students linked to it fall back to the default menu until their next message. Add --apply to run.`);
      return;
    }
    if (!token) throw new RichMenuSetupError('Set LINE_CHANNEL_ACCESS_TOKEN in the shell for this command.');
    await deleteRichMenu({ client: createLineClient({ token }), richMenuId });
    console.log(`Deleted ${richMenuId}.`);
    return;
  }

  const only = readArg(argv, '--only');
  if (only && only !== 'bound') throw new RichMenuSetupError('--only accepts "bound" only.');
  const definitions = buildRichMenuDefinitions(readArg(argv, '--site-url'));
  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true,
      ...(only ? {} : { unbound: definitions.unbound.body }),
      bound: definitions.bound.body,
    }, null, 2));
    console.log('Dry run only. Add --apply (with LINE_CHANNEL_ACCESS_TOKEN set) to create the menus.');
    return;
  }
  if (!token) throw new RichMenuSetupError('Set LINE_CHANNEL_ACCESS_TOKEN in the shell for this command.');

  const ids = await createRichMenus({ client: createLineClient({ token }), definitions, only });
  console.log(JSON.stringify(ids, null, 2));
  console.log(`Next: set LINE_RICH_MENU_BOUND_ID=${ids.bound} in backend/.env and restart the backend.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof RichMenuSetupError ? error.message : 'Rich menu setup failed; nothing was set as default.');
    process.exitCode = 1;
  });
}

module.exports = {
  buildRichMenuDefinitions,
  createLineClient,
  createRichMenus,
  deleteRichMenu,
  rollbackRichMenus,
  main,
};
