'use strict';

const { COMPONENT_NAMES, TOKEN_STYLES, CODE_SOURCES } = require('./components');
const str = (description) => ({ type: 'STRING', ...(description ? { description } : {}) });
const number = { type: 'NUMBER' };
const integer = { type: 'INTEGER' };
const arr = (items) => ({ type: 'ARRAY', items });
const obj = (properties, required = []) => ({ type: 'OBJECT', properties, ...(required.length ? { required } : {}) });
const item = obj({ text: str(), icon: str('approved fluent:name or phosphor:name') }, ['text']);
const ANCHOR_SCHEMA = obj({ sentenceId: str(), text: str('unique complete-word phrase within that sentence, optional') }, ['sentenceId']);
const PARAM_SCHEMAS = {
  stat: obj({ value: str(), label: str(), kicker: str(), unit: str(), badge: str(), icon: str() }, ['value']),
  slots: obj({ count: integer, badge: str(), label: str(), icon: str() }, ['count', 'badge']),
  rows: obj({ rows: arr(obj({ tokens: arr(obj({ t: str(), style: { type: 'STRING', enum: TOKEN_STYLES }, icon: str() }, ['t'])) }, ['tokens'])), note: str() }, ['rows']),
  'quote-reveal': obj({ text: str(), label: str(), icon: str() }, ['text']),
  chips: obj({ chips: arr(item), highlight: arr(integer), dimKeep: integer, question: { type: 'BOOLEAN' }, note: str(), caption: str() }, ['chips']),
  compare: obj({ left: obj({ text: str(), value: str(), label: str(), icon: str(), highlight: { type: 'BOOLEAN' }, bad: { type: 'BOOLEAN' } }, ['text']), right: obj({ text: str(), value: str(), label: str(), icon: str(), highlight: { type: 'BOOLEAN' }, bad: { type: 'BOOLEAN' } }, ['text']), link: str(), mark: { type: 'STRING', enum: ['✕', '✓', 'none'] } }, ['left', 'right']),
  checklist: obj({ items: arr(item), head: str(), banner: str(), mark: { type: 'STRING', enum: ['✕', '✓', 'none'] } }, ['items']),
  'place-values': obj({ digits: arr(str()), labels: arr(item), note: str(), icon: str() }, ['digits', 'labels']),
  relation: obj({ words: arr(item), note: str() }, ['words']),
  'not-fit': obj({ object: item, container: item }, ['object', 'container']),
  'not-merge': obj({ left: item, right: item, result: item }, ['left', 'right', 'result']),
  nested: obj({ layers: arr(item) }, ['layers']),
  code: obj({ language: { type: 'STRING', enum: ['javascript', 'python', 'cpp', 'c', 'csharp', 'java', 'text'] },
    lines: arr(obj({ text: str(), source: { type: 'STRING', enum: CODE_SOURCES }, originalText: str(), intentionalError: { type: 'BOOLEAN' } }, ['text', 'source', 'originalText'])),
    highlightLines: arr(integer), boxes: arr(obj({ line: integer, text: str() }, ['line', 'text'])), errorMessage: str(), requiredVariables: arr(str()), diagram: obj({ layers: arr(item) }, ['layers']) }, ['language', 'lines']),
};
const DETAILS = {
  stat: ['凸顯一個數值或短重點。', { value: '重點', label: '結論' }, '不要用來列多項步驟。'],
  slots: ['顯示有限插槽與容量。', { count: 3, badge: '記憶體', icon: 'fluent:desktop-computer' }, '不要把槽數當成沒有來源的精確數據。'],
  rows: ['按列排版算式或短文字。', { rows: [{ tokens: [{ t: '需求', style: 'mid' }, { t: '增加', style: 'huge' }] }] }, '不要放整段講稿。'],
  'quote-reveal': ['逐步揭露一句短重點。', { label: '定義', text: '工具負責處理資料' }, '不要放超過二十四字的長句。'],
  chips: ['拆開詞語並強調其中幾個。', { chips: [{ text: '附近' }, { text: '餐廳', icon: 'fluent:fork-and-knife' }], highlight: [1] }, '不要用詞序表示未說明的因果。'],
  compare: ['以左右兩欄比較概念。', { left: { text: '工具', icon: 'fluent:toolbox' }, right: { text: '模型', icon: 'fluent:brain' }, link: '→' }, '不要把兩者畫成同一物件。'],
  checklist: ['逐項呈現清單或檢查結果。', { items: [{ text: '輸入' }, { text: '輸出' }], mark: '✓' }, '不要用勾號宣稱老師未提到的正確性。'],
  'place-values': ['用格子說明數字位值。', { digits: ['2', '0'], labels: [{ text: '十位' }, { text: '個位' }] }, '不要用來做無來源的數字推導。'],
  relation: ['以連線呈現三個概念或流程。', { words: [{ text: '輸入' }, { text: '處理' }, { text: '輸出' }] }, '不要假設連線自動代表因果。'],
  'not-fit': ['顯示物件受容器容量限制而放不進去。', { object: { text: '大模型', icon: 'fluent:desktop-computer' }, container: { text: '記憶體', icon: 'fluent:laptop' } }, '不要用在可放入或只是比較大小的情況。'],
  'not-merge': ['顯示分開的零件不能直接合成目標。', { left: { text: '小桌' }, right: { text: '小桌' }, result: { text: '大桌' } }, '不要把目標覆蓋在兩物件上，造成已合成的誤解。'],
  nested: ['用外到內的框表示層層包含。', { layers: [{ text: '全域' }, { text: '函式' }, { text: '區塊' }] }, '不要用在互斥、平行或非包含關係。'],
  code: ['呈現來源畫面的短程式碼與指定行文字框。', { language: 'python', lines: [{ text: 'x = 1', source: '畫面原樣', originalText: 'x = 1' }], highlightLines: [1] }, '只接受 RC6 畫面抄錄與審核結果；不要讓配圖步驟自己編程式。'],
};

function getComponentCatalog({ aiOnly = false } = {}) {
  return COMPONENT_NAMES.map((name) => {
    const [purpose, example, doNotUse] = DETAILS[name];
    // Three relation cards passed the separate mobile review; code stays RC6-only.
    const aiEnabled = name !== 'code';
    return { name, purpose, paramsSchema: structuredClone(PARAM_SCHEMAS[name]), example: `{\n  ${Object.entries(example).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}\n}`, doNotUse, aiEnabled,
      review: ['not-fit', 'not-merge', 'nested'].includes(name) ? 'independent-mobile-reviewed-20261104' : name === 'code' ? 'rc6-only' : 'existing' };
  }).filter((v) => !aiOnly || v.aiEnabled);
}

function getCardsResponseSchema() {
  const names = getComponentCatalog({ aiOnly: true }).map((v) => v.name);
  const params = obj(Object.assign({}, ...names.map((name) => PARAM_SCHEMAS[name].properties)));
  // A superset is intentional: component-specific required fields are checked
  // in describeComponent; Gemini object schemas never contain an empty OBJECT.
  const cueNames = ['label', 'kicker', 'value', 'unit', 'badge', 'show', 'note', 'text', 'enter', 'caption', 'dim', 'q', 'left', 'right', 'link', 'mark', 'head', 'banner', 'stamp', 'l0', 'l1', 'object', 'container', 'attempt', 'reject', 'layer0', 'layer1', 'layer2'];
  for (let i = 0; i < 6; i++) cueNames.push(`lit${i}`, `hl${i}`, `item${i}`, `d${i}`, `w${i}`);
  for (let r = 0; r < 4; r++) for (let t = 0; t < 6; t++) cueNames.push(`r${r}t${t}`);
  // Transport only: one anchor object per cue name made the schema too large for
  // Gemini (HTTP 400 INVALID_ARGUMENT). The model returns a keyed list instead;
  // the backend cards step folds it back into the plan's `cues` object.
  const cues = arr(obj({ key: { type: 'STRING', enum: cueNames }, sentenceId: str(), text: str('unique complete-word phrase within that sentence, optional') }, ['key', 'sentenceId']));
  return obj({
    scenes: arr(obj({ id: str(), from: str(), to: str(), component: { type: 'STRING', enum: names }, params, cues, stamp: obj({ text: str(), tone: { type: 'STRING', enum: ['alert'] } }, ['text']) }, ['id', 'from', 'to', 'component', 'params', 'cues'])),
    subtitles: arr(obj({ from: ANCHOR_SCHEMA, runs: arr(obj({ t: str(), hl: { type: 'BOOLEAN' } }, ['t'])), level: { type: 'STRING', enum: ['condensed', 'corrected'] } }, ['from', 'runs'])),
  }, ['scenes', 'subtitles']);
}

module.exports = { getComponentCatalog, getCardsResponseSchema, PARAM_SCHEMAS, ANCHOR_SCHEMA };
