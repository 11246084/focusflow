const fs = require('fs');
const path = require('path');

const openApiPath = path.resolve(__dirname, '../../docs/openapi.yaml');

function readOpenApiYaml() {
  return fs.readFileSync(openApiPath, 'utf8');
}

module.exports = {
  openApiPath,
  readOpenApiYaml,
};
