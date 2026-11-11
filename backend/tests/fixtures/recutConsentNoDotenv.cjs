// Preload before application modules: no secret file is opened.
require.cache[require.resolve('dotenv')] = {
  id: require.resolve('dotenv'), filename: require.resolve('dotenv'), loaded: true,
  exports: { config: () => ({ parsed: {} }) },
};
