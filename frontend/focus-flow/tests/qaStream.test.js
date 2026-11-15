import test from 'node:test';
import assert from 'node:assert/strict';
import { apiStream } from '../src/api.js';
import { getUnansweredMessages, hasNewUserMessage, isStaleMessage } from '../src/pages/qaConversationUtils.js';

function response(chunks, status = 200) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
    controller.close();
  } }), { status });
}

test('stream parses fragmented SSE frames, comments, UTF-8 and terminates at done', async () => {
  const events = [];
  let request;
  await apiStream('/conversations/1/messages/stream', { method: 'POST', fetchImpl: async (url, options) => {
    request = { url, options };
    return response([': keepalive\r', '\n\r\nevent: accepted\ndata: {"userMessageId":"1"}\n\n', 'event: stage\ndata: {"stage":"writ', 'ing"}\n\nevent: done\ndata: {"data":{"answer":"回答"}}\n\n']);
  } }, (event, data) => events.push([event, data]));
  assert.deepEqual(events.map(([event]) => event), ['accepted', 'stage', 'done']);
  assert.equal(events[2][1].data.answer, '回答');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.headers['X-Requested-With'], 'FocusFlow');
});

test('stream reports HTTP errors, server error events and incomplete streams', async () => {
  await assert.rejects(apiStream('/x', { fetchImpl: async () => response(['{}'], 405) }), { status: 405 });
  await assert.rejects(apiStream('/x', { fetchImpl: async () => response(['event: error\ndata: {"message":"失敗"}\n\n']) }), /失敗/);
  await assert.rejects(apiStream('/x', { fetchImpl: async () => response(['event: accepted\ndata: {}\n\n']) }), /連線中斷/);
});

test('finds pending and orphan messages anywhere and compares recovery boundary', () => {
  const messages = [
    { id: 'u1', role: 'user', createdAt: '2020-01-01' },
    { id: 'a1', role: 'assistant', replyToMessageId: 'u1', status: 'pending', updatedAt: '2020-01-01' },
    { id: 'u2', role: 'user', createdAt: '2020-01-01' },
    { id: 'u3', role: 'user' }, { id: 'a3', role: 'assistant', replyToMessageId: 'u3', status: 'completed' },
  ];
  assert.deepEqual(getUnansweredMessages(messages).map((item) => item.id), ['a1', 'u2']);
  assert.equal(isStaleMessage(messages[1], Date.parse('2020-01-01') + 120000), true);
  assert.equal(hasNewUserMessage(messages, 'a1'), true);
  assert.equal(hasNewUserMessage(messages, 'a3'), false);
  assert.equal(hasNewUserMessage(messages, 'missing'), true);
});

test('ambiguous HTTP and retry failures stay in recovery until the server state changes', async () => {
  const { isDefiniteRejection, isRetryRecoveryPending } = await import('../src/pages/qaConversationUtils.js');
  assert.equal(isDefiniteRejection({ status: 429 }), true);
  assert.equal(isDefiniteRejection({ status: 502 }), false);
  assert.equal(isDefiniteRejection(new TypeError('network')), false);
  const recovery = { retry: true, messageId: 'a', status: 'failed', updatedAt: 'old', startedAt: 1000 };
  assert.equal(isRetryRecoveryPending([{ id: 'a', status: 'failed', updatedAt: 'old' }], recovery, 2000), true);
  assert.equal(isRetryRecoveryPending([{ id: 'a', status: 'pending', updatedAt: 'new' }], recovery, 2000), false);
  assert.equal(isRetryRecoveryPending([{ id: 'a', status: 'failed', updatedAt: 'old' }], recovery, 121000), false);
});

test('a 502 or dropped stream performs one POST and exposes the failure for recovery', async () => {
  for (const makeResponse of [() => response(['{}'], 502), () => response(['event: accepted\ndata: {"userMessageId":"u1"}\n\n'])]) {
    let posts = 0;
    await assert.rejects(apiStream('/conversations/1/messages/stream', { method: 'POST', fetchImpl: async () => { posts += 1; return makeResponse(); } }));
    assert.equal(posts, 1);
  }
});
