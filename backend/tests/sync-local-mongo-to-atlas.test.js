const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  COLLECTIONS,
  buildSyncOperation,
  syncCollection,
} = require('../src/scripts/syncLocalMongoToAtlas');

describe('syncLocalMongoToAtlas collection contract', () => {
  it('includes notifications in the backend-owned sync list', () => {
    assert.equal(COLLECTIONS.includes('notifications'), true);
    assert.equal(new Set(COLLECTIONS).size, COLLECTIONS.length);
  });

  it('users sync 使用 ownership-aware update，不攜帶 source local avatar metadata', () => {
    const operation = buildSyncOperation('users', {
      _id: 'user-1',
      name: 'Local Name',
      email: 'local@example.com',
      avatar: {
        filename: 'local-only.png',
        mimeType: 'image/png',
        updatedAt: new Date('2026-07-24T00:00:00.000Z'),
      },
    });

    assert.equal(Boolean(operation.replaceOne), false);
    assert.deepEqual(operation.updateOne.filter, { _id: 'user-1' });
    assert.equal(operation.updateOne.upsert, true);
    assert.deepEqual(operation.updateOne.update.$set, {
      name: 'Local Name',
      email: 'local@example.com',
    });
    assert.equal(
      JSON.stringify(operation).includes('local-only.png'),
      false,
    );
  });

  it('users sync 保留既有 target avatar，new user upsert 也不建立 local avatar metadata', async () => {
    const sourceUsers = [
      {
        _id: 'existing-user',
        name: 'Updated Name',
        avatar: {
          filename: 'source-local.png',
          mimeType: 'image/png',
          updatedAt: new Date('2026-07-24T00:00:00.000Z'),
        },
      },
      {
        _id: 'new-user',
        name: 'New User',
        avatar: {
          filename: 'source-new-local.webp',
          mimeType: 'image/webp',
          updatedAt: new Date('2026-07-24T00:00:00.000Z'),
        },
      },
    ];
    const targetUsers = [{
      _id: 'existing-user',
      name: 'Old Name',
      avatar: {
        filename: 'target-owned.jpg',
        mimeType: 'image/jpeg',
        updatedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    }];
    const sourceDb = {
      collection() {
        return {
          find() {
            return {
              async toArray() {
                return sourceUsers;
              },
            };
          },
        };
      },
    };
    const targetDb = {
      collection() {
        return {
          async bulkWrite(operations) {
            for (const { updateOne } of operations) {
              let target = targetUsers.find(
                (user) => user._id === updateOne.filter._id,
              );
              if (!target) {
                target = { _id: updateOne.filter._id };
                targetUsers.push(target);
              }
              Object.assign(target, updateOne.update.$set);
            }
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
          },
        };
      },
    };

    await syncCollection(sourceDb, targetDb, 'users');

    assert.deepEqual(
      targetUsers.find((user) => user._id === 'existing-user').avatar,
      {
        filename: 'target-owned.jpg',
        mimeType: 'image/jpeg',
        updatedAt: new Date('2026-07-23T00:00:00.000Z'),
      },
    );
    assert.equal(
      Object.hasOwn(targetUsers.find((user) => user._id === 'new-user'), 'avatar'),
      false,
    );
  });
});
