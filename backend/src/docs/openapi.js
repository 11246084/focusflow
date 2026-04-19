const fs = require('fs');
const path = require('path');

const openApiPath = path.resolve(__dirname, '../../docs/openapi.yaml');
const customCssPath = path.resolve(__dirname, 'swagger-custom.css');

function readOpenApiYaml() {
  return fs.readFileSync(openApiPath, 'utf8');
}

function readSwaggerCustomCss() {
  return fs.readFileSync(customCssPath, 'utf8');
}

module.exports = {
  openApiPath,
  readOpenApiYaml,
  readSwaggerCustomCss,
};
