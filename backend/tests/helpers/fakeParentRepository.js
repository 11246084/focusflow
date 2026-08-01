function createFakeParentRepository({ hits = [], error = null, delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async searchParents(input) {
      calls.push(input);
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (error) throw error;
      return hits;
    },
  };
}

module.exports = { createFakeParentRepository };
