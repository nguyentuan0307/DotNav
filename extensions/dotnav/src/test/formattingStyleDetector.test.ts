import assert from 'assert/strict';
import test from 'node:test';
import {
  detectFormattingIntent
} from '../format/formattingStyleDetector';
import { fluentChainSignature } from '../format/csharpFluentChainModel';

test('detects an intentional two-level fluent continuation', () => {
  const input = [
    '\t\tvar values = source',
    '\t\t\t\t.Where(item => item.Enabled)',
    '\t\t\t\t.Select(item => item.Id)',
    '\t\t\t\t.ToList();'
  ].join('\n');

  const snapshot = detectFormattingIntent(input, 4);

  assert.equal(snapshot.fluentChains.length, 1);
  assert.equal(snapshot.fluentChains[0].continuationIndentColumns, 8);
  assert.equal(snapshot.fluentChains[0].evidenceCount, 3);
});

test('detects a dominant style only when repeated evidence has a clear majority', () => {
  const input = [
    '\tvar first = source',
    '\t\t\t.Where(x => x.Enabled)',
    '\t\t\t.ToList();',
    '\tvar second = source',
    '\t\t\t.Select(x => x.Id)',
    '\t\t\t.ToArray();',
    '\tvar conventional = source',
    '\t\t.Where(x => x.Enabled)',
    '\t\t.ToList();'
  ].join('\n');

  assert.equal(detectFormattingIntent(input, 4).dominantFluentIndentMultiplier, 2);
});

test('does not treat inconsistent continuation indentation as explicit intent', () => {
  const input = [
    '\tvar values = source',
    '\t\t\t.Where(item => item.Enabled)',
    '\t\t.Select(item => item.Id)',
    '\t\t\t.ToList();'
  ].join('\n');

  const snapshot = detectFormattingIntent(input, 4);

  assert.equal(snapshot.fluentChains.length, 0);
  assert.equal(snapshot.dominantFluentIndentMultiplier, undefined);
});

test('fluent signatures ignore whitespace but preserve code identity', () => {
  const compact = fluentChainSignature(['  .Where(x=>x.Enabled)', '  .ToList()'], [0, 1]);
  const spaced = fluentChainSignature(['\t\t.Where(x => x.Enabled)', '\t\t.ToList()'], [0, 1]);
  const different = fluentChainSignature(['\t\t.Where(x => x.Disabled)', '\t\t.ToList()'], [0, 1]);

  assert.equal(compact, spaced);
  assert.notEqual(compact, different);
});

test('detects an intentional two-level multiline argument indent', () => {
  const input = [
    '\t\tCall(first',
    '\t\t\t\t, second',
    '\t\t\t\t, third',
    '\t\t);'
  ].join('\n');

  const snapshot = detectFormattingIntent(input, 4);

  assert.equal(snapshot.multilineLists.length, 1);
  assert.equal(snapshot.multilineLists[0].continuationIndentColumns, 8);
  assert.equal(snapshot.multilineLists[0].evidenceCount, 2);
});
