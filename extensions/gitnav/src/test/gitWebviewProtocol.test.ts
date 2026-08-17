import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GitWebviewMessageRouter,
  parseGitWebviewMessage
} from '../git/gitWebviewProtocol';

test('accepts known Git webview messages', () => {
  assert.deepEqual(parseGitWebviewMessage({ type: 'detail', hash: 'abc123' }), {
    type: 'detail',
    hash: 'abc123'
  });
  assert.deepEqual(parseGitWebviewMessage({ type: 'fileDiff', path: 'src/main.ts', hash: 'abc123', parent: 1 }), {
    type: 'fileDiff',
    path: 'src/main.ts',
    hash: 'abc123',
    parent: 1
  });
});

test('rejects malformed and unknown Git webview messages', () => {
  assert.equal(parseGitWebviewMessage(undefined), undefined);
  assert.equal(parseGitWebviewMessage({}), undefined);
  assert.equal(parseGitWebviewMessage({ type: 'unknown' }), undefined);
});

test('routes only validated Git webview messages', async () => {
  const handled: string[] = [];
  const rejected: unknown[] = [];
  const router = new GitWebviewMessageRouter(
    async message => { handled.push(message.type); },
    value => { rejected.push(value); }
  );

  await router.route({ type: 'ready' });
  await router.route({ type: 'unknown' });

  assert.deepEqual(handled, ['ready']);
  assert.equal(rejected.length, 1);
});
