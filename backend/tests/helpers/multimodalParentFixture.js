const { retrieveWithHierarchy } = require('../../src/services/hierarchicalRetrieval.service');
const { buildGeminiTextSearchContract } = require('../../src/services/embeddingContract.service');

function createParentFixture() {
  const contract = buildGeminiTextSearchContract();
  const courseId = 'synthetic-course';
  const videoId = 'synthetic-video';
  const leaves = [10, 22, 40].map((startSec, index) => ({ courseId, videoId,
    chunkId: `synthetic-child-${index}`, segmentId: `synthetic-child-${index}`,
    startSec, endSec: startSec + 2, text: `Synthetic teacher transcript ${index}` }));
  const parent = { parentId: 'synthetic-parent', courseId, videoId,
    syntheticEmbedding: [1, 0],
    childChunkIds: leaves.slice(1).map(leaf => leaf.chunkId), startSec: 0, endSec: 90,
    order: 1, hierarchyLevel: 1, documentType: 'parent_chunk', isActive: true,
    embeddingProvider: contract.provider, embeddingModel: contract.model, embeddingDimension: contract.dimension,
    embeddingTaskType: contract.taskType, embeddingInstructionVersion: contract.instructionVersion,
    generationVersion: contract.generationVersion, normalizationVersion: contract.normalizationVersion,
    embeddingContractVersion: contract.contractVersion, embeddingSchemaVersion: 'parent_embedding_v2' };
  const scope = { allowedCourseIds: new Set([courseId]), allowedVideoIds: new Set([videoId]) };
  const flat = { matches: [{ ...leaves[0], transcript: leaves[0].text, score: 0.5 }], diagnostics: {} };
  const calls = [];
  async function retrieve({ parents = [parent], documents = leaves, ...overrides } = {}) {
    return retrieveWithHierarchy({ enabled: true, fallbackToLeaf: true, courseId, scope,
      allowedVideoIds: [videoId], restrictedVideoIds: [videoId], queryEmbedding: [1, 0],
      parentRepositoryFactory: () => ({ searchParents: async input => {
        calls.push(input);
        // Synthetic normalized vectors rank parents, never Atlas or paid embeddings.
        return parents.map(row => ({ ...row,
          score: row.syntheticEmbedding.reduce((sum, value, index) => sum + value * input.queryEmbedding[index], 0),
        })).sort((a, b) => b.score - a.score || a.parentId.localeCompare(b.parentId));
      } }),
      leafRepositoryFactory: () => ({ findLeavesByChunkIds: async ids => documents.filter(row => ids.includes(row.chunkId)) }),
      leafSearch: async () => flat, parentLimit: 5, childExpansionLimit: 20,
      contextMaxLeaves: 20, contextMaxCharacters: 5000, parentTimeoutMs: 100,
      ...overrides });
  }
  return { provenance: 'synthetic-parent-and-repositories', courseId, videoId, leaves, parent, scope, flat, calls, retrieve };
}
module.exports = { createParentFixture };
