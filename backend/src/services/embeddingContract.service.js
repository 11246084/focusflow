// 這些值共同定義 Backend、Pipeline 與 Database 必須一致的向量空間。
// 維度相同不代表相容；模型、instruction、generation 與正規化版本也必須一致。
const GEMINI_EMBEDDING_2_MODEL = 'gemini-embedding-2';
const GEMINI_EMBEDDING_DIMENSIONS = 3072;
const GEMINI_EMBEDDING_INSTRUCTION_VERSION = 'gemini_embedding_2_search_v1';
const TEXT_SEARCH_GENERATION_VERSION = 'text_search_generation_v1';
const UNIT_L2_NORMALIZATION_VERSION = 'unit_l2_v1';
const GEMINI_EMBEDDING_CONTRACT_VERSION = 'gemini_embedding_2_text_v1';

// health 逐欄比較完整契約，避免只檢查 3072 維而誤判新舊向量可以混用。
const CONTRACT_FIELDS = [
  'provider',
  'model',
  'dimension',
  'instructionVersion',
  'generationVersion',
  'normalizationVersion',
  'contractVersion',
  'schemaVersion',
  'taskType',
];

function isStableGeminiEmbeddingModel(model) {
  return String(model || '').trim() === GEMINI_EMBEDDING_2_MODEL;
}

function buildGeminiTextSearchContract(model = GEMINI_EMBEDDING_2_MODEL) {
  return {
    provider: 'gemini',
    model: String(model || '').trim(),
    dimension: GEMINI_EMBEDDING_DIMENSIONS,
    instructionVersion: GEMINI_EMBEDDING_INSTRUCTION_VERSION,
    generationVersion: TEXT_SEARCH_GENERATION_VERSION,
    normalizationVersion: UNIT_L2_NORMALIZATION_VERSION,
    contractVersion: GEMINI_EMBEDDING_CONTRACT_VERSION,
    schemaVersion: GEMINI_EMBEDDING_CONTRACT_VERSION,
    // Stable Gemini 以文字 instruction 表達查詢用途，不再使用 preview taskType。
    taskType: null,
  };
}

// instruction 是向量契約的一部分；修改文字時也必須升級版本並重建資料向量。
function buildGeminiSearchQueryText(content) {
  return `task: search result | query: ${String(content || '').trim()}`;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

// 遷移期間可能讀到不同年代的欄位名稱，先正規化成單一格式再進行比較。
function normalizeActiveContract(contract) {
  const contractVersion = firstDefined(
    contract.contractVersion,
    contract.embeddingContractVersion,
    contract.embeddingSchemaVersion,
    contract.schemaVersion,
  );
  const schemaVersion = firstDefined(
    contract.schemaVersion,
    contract.embeddingSchemaVersion,
    contract.embeddingContractVersion,
    contract.contractVersion,
  );
  const normalized = {
    provider: firstDefined(contract.provider, contract.embeddingProvider),
    model: firstDefined(contract.model, contract.embeddingModel),
    dimension: firstDefined(contract.dimension, contract.embeddingDimension),
    instructionVersion: firstDefined(
      contract.instructionVersion,
      contract.embeddingInstructionVersion,
    ),
    generationVersion: firstDefined(contract.generationVersion),
    normalizationVersion: firstDefined(contract.normalizationVersion),
    contractVersion,
    taskType: firstDefined(contract.taskType, contract.embeddingTaskType, null),
  };

  return {
    ...normalized,
    schemaVersion: schemaVersion ?? null,
  };
}

// 空值代表尚未宣告；格式錯誤仍保留 declared=true，讓 health 明確回報設定錯誤。
function parseActiveEmbeddingContract(rawValue, source) {
  if (!rawValue || !String(rawValue).trim()) {
    return { source, declared: false, contract: null, error: null };
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('contract metadata must be an object');
    }

    return {
      source,
      declared: true,
      contract: normalizeActiveContract(parsed),
      error: null,
    };
  } catch {
    return {
      source,
      declared: true,
      contract: null,
      error: 'Invalid JSON contract metadata.',
    };
  }
}

// 回傳不相符的欄位，讓 health 能指出真正破壞相容性的契約內容。
function compareEmbeddingContracts(expected, active) {
  if (!active) return ['active_contract_missing'];

  return CONTRACT_FIELDS.filter((field) => active[field] !== expected[field]);
}

module.exports = {
  CONTRACT_FIELDS,
  GEMINI_EMBEDDING_2_MODEL,
  GEMINI_EMBEDDING_DIMENSIONS,
  GEMINI_EMBEDDING_INSTRUCTION_VERSION,
  TEXT_SEARCH_GENERATION_VERSION,
  UNIT_L2_NORMALIZATION_VERSION,
  GEMINI_EMBEDDING_CONTRACT_VERSION,
  isStableGeminiEmbeddingModel,
  buildGeminiTextSearchContract,
  buildGeminiSearchQueryText,
  parseActiveEmbeddingContract,
  compareEmbeddingContracts,
};
