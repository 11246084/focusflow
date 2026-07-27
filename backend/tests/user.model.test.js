const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const User = require('../src/models/user.model');

function buildUser(overrides = {}) {
  return new User({
    name: 'Schema Contract User',
    email: 'schema-contract@example.com',
    passwordHash: 'not-a-real-password-hash',
    role: 'student',
    ...overrides,
  });
}

describe('User model lineUserId contract', () => {
  it('未提供 lineUserId 時 document 與 serialization 都完全省略欄位', () => {
    const lineUserIdPath = User.schema.path('lineUserId');
    const firstUser = buildUser({
      email: 'schema-contract-one@example.com',
    });
    const secondUser = buildUser({
      email: 'schema-contract-two@example.com',
    });

    assert.equal(lineUserIdPath.defaultValue, undefined);

    for (const user of [firstUser, secondUser]) {
      assert.equal(user.get('lineUserId'), undefined);
      assert.equal(Object.hasOwn(user.toObject(), 'lineUserId'), false);
      assert.equal(Object.hasOwn(user.toJSON(), 'lineUserId'), false);
    }
  });

  it('已提供 lineUserId 時保留 trim 與 unique sparse index 契約', () => {
    const lineUserIdPath = User.schema.path('lineUserId');
    const user = buildUser({
      lineUserId: '  line-bound-user  ',
    });

    assert.equal(lineUserIdPath.options.trim, true);
    assert.equal(lineUserIdPath.options.unique, true);
    assert.equal(lineUserIdPath.options.sparse, true);
    assert.equal(user.get('lineUserId'), 'line-bound-user');
    assert.equal(user.toObject().lineUserId, 'line-bound-user');
  });
});
