'use strict';

// Offline payload probes only: no SDK, fetch, credentials or provider calls.
const { draftJsonSchema, LearningUiDraftSchema } = require('../index.cjs');

function geminiSchema(node) {
  const result = { type: node.type.toUpperCase() };
  if (node.const !== undefined) result.enum = [node.const];
  if (node.enum) result.enum = node.enum;
  if (node.properties) result.properties = Object.fromEntries(
    Object.entries(node.properties).map(([key, value]) => [key, geminiSchema(value)]),
  );
  if (node.required) result.required = node.required;
  if (node.items) result.items = geminiSchema(node.items);
  for (const key of ['minItems', 'maxItems']) if (node[key] !== undefined) result[key] = node[key];
  return result;
}
function payload(provider, componentType) {
  // Planner chooses one allowed component: no polymorphic union in the request.
  const schema = draftJsonSchema(componentType);
  delete schema.$schema;
  if (provider === 'openai') {
    return { response_format: { type: 'json_schema', json_schema: {
      name: 'learning_ui_draft', strict: true, schema,
    } } };
  }
  if (provider === 'gemini') {
    return { generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(schema) } };
  }
  throw new TypeError('Unsupported mock provider');
}

// Test-only structural interpreter checks the generated payload, independently
// of Zod. It is deliberately limited to the schema keywords used by these mocks.
function accepts(schema, value) {
  const type = schema.type.toLowerCase();
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if ((schema.required || []).some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    return Object.entries(schema.properties).every(([key, child]) => !Object.hasOwn(value, key) || accepts(child, value[key]));
  }
  if (type === 'array') {
    return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
      && value.length <= (schema.maxItems ?? Infinity) && value.every(item => accepts(schema.items, item));
  }
  if (type === 'string') {
    return typeof value === 'string' && (schema.const === undefined || value === schema.const)
      && (!schema.enum || schema.enum.includes(value)) && value.length >= (schema.minLength ?? 0)
      && (!schema.pattern || new RegExp(schema.pattern).test(value));
  }
  throw new Error(`Uncovered mock keyword/type: ${type}`);
}
function response(provider, value) {
  const json = JSON.stringify(value);
  if (provider === 'openai') return { choices: [{ message: { content: json } }] };
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text: json }] } }] };
  throw new TypeError('Unsupported mock provider');
}
function parseResponse(provider, body) {
  let json;
  if (provider === 'openai') json = body.choices[0].message.content;
  else if (provider === 'gemini') json = body.candidates[0].content.parts[0].text;
  else throw new TypeError('Unsupported mock provider');
  return LearningUiDraftSchema.parse(JSON.parse(json));
}
module.exports = { payload, accepts, response, parseResponse };
