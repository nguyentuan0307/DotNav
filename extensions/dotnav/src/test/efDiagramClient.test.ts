import assert from 'node:assert/strict';
import test from 'node:test';
import { getEfDiagramClientScript } from '../ef/diagram/efDiagramClient';

function extractFunction(script: string, name: string, nextMarker: string): string {
  const start = script.indexOf(`  function ${name}(`);
  const end = script.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `${name} must exist in the generated client script`);
  assert.notEqual(end, -1, `${name} must end before ${nextMarker}`);
  return script.slice(start, end);
}

function createGeometryHarness(
  lineStyle: 'curved' | 'orthogonal',
  activePositions: Record<string, { x: number; y: number }>,
  cardSizeCache: Record<string, { width: number; height: number }>,
  cardRowOffsetCache: Record<string, Record<string, number>>,
  minimizedCards = new Set<string>()
): (relationship: Record<string, string>) => Record<string, number | string> | null {
  const script = getEfDiagramClientScript();
  const source = extractFunction(script, 'computeRelGeometry', '\n\n  // Build SVG Elements');
  return new Function(
    'activePositions',
    'cardSizeCache',
    'cardRowOffsetCache',
    'minimizedCards',
    'lineStyle',
    `${source}\nreturn computeRelGeometry;`
  )(activePositions, cardSizeCache, cardRowOffsetCache, minimizedCards, lineStyle);
}

test('routes curved and orthogonal self relationships as compact right-side loops', () => {
  const positions = { Form: { x: 100, y: 50 } };
  const sizes = { Form: { width: 310, height: 220 } };
  const offsets = { Form: { Id: 50, ParentId: 150 } };
  const relationship = {
    fromEntity: 'Form',
    toEntity: 'Form',
    fromProperty: 'Id',
    toProperty: 'ParentId'
  };

  const curved = createGeometryHarness('curved', positions, sizes, offsets)(relationship);
  assert.ok(curved);
  assert.equal(curved.x1, 410);
  assert.equal(curved.x2, 410);
  assert.equal(curved.y1, 100);
  assert.equal(curved.y2, 200);
  assert.ok(Number(curved.cx1) > 410);
  assert.ok(Number(curved.cx1) <= 495);
  assert.match(String(curved.pathData), /^M 410 100 C /);

  const orthogonal = createGeometryHarness('orthogonal', positions, sizes, offsets)(relationship);
  assert.ok(orthogonal);
  assert.equal(orthogonal.x1, 410);
  assert.equal(orthogonal.x2, 410);
  assert.match(String(orthogonal.pathData), /^M 410 100 L \d+ 100 L \d+ 200 L 410 200$/);
});

test('keeps minimized self relationships visible when both anchors initially overlap', () => {
  const compute = createGeometryHarness(
    'curved',
    { Form: { x: 20, y: 30 } },
    { Form: { width: 310, height: 40 } },
    { Form: { __pkDefault: 18, __fkDefault: 18 } },
    new Set(['Form'])
  );

  const geometry = compute({ fromEntity: 'Form', toEntity: 'Form' });
  assert.ok(geometry);
  assert.notEqual(geometry.y1, geometry.y2);
  assert.ok(Number(geometry.y1) >= 30 && Number(geometry.y1) <= 70);
  assert.ok(Number(geometry.y2) >= 30 && Number(geometry.y2) <= 70);
});

test('preserves ordinary relationship routing between separate cards', () => {
  const compute = createGeometryHarness(
    'curved',
    { Parent: { x: 0, y: 10 }, Child: { x: 300, y: 40 } },
    { Parent: { width: 100, height: 160 }, Child: { width: 100, height: 160 } },
    { Parent: { Id: 50 }, Child: { ParentId: 90 } }
  );

  const geometry = compute({
    fromEntity: 'Parent',
    toEntity: 'Child',
    fromProperty: 'Id',
    toProperty: 'ParentId'
  });
  assert.ok(geometry);
  assert.equal(geometry.x1, 100);
  assert.equal(geometry.x2, 300);
  assert.equal(geometry.y1, 60);
  assert.equal(geometry.y2, 130);
});

test('calculates row anchors relative to the scrolled card viewport and clamps offscreen rows', () => {
  const script = getEfDiagramClientScript();
  const source = extractFunction(script, 'cacheCardLayout', '\n\n  // Render Canvas');
  const cardSizeCache: Record<string, { width: number; height: number }> = {};
  const cardRowOffsetCache: Record<string, Record<string, number>> = {};
  const rows = [
    { dataset: { propName: 'Id' }, offsetTop: 50, offsetHeight: 20, classList: { contains: (name: string) => name === 'pk' } },
    { dataset: { propName: 'ParentId' }, offsetTop: 150, offsetHeight: 20, classList: { contains: (name: string) => name === 'fk' } },
    { dataset: { propName: 'LastField' }, offsetTop: 350, offsetHeight: 20, classList: { contains: () => false } }
  ];
  const cardBody = { scrollTop: 100 };
  const card = {
    offsetWidth: 310,
    offsetHeight: 200,
    classList: { contains: () => false },
    querySelector: () => cardBody,
    querySelectorAll: () => rows
  };
  const document = { getElementById: () => card };
  const cacheLayout = new Function(
    'document',
    'cardSizeCache',
    'cardRowOffsetCache',
    `${source}\nreturn cacheCardLayout;`
  )(document, cardSizeCache, cardRowOffsetCache);

  cacheLayout('Form');

  assert.deepEqual(cardSizeCache.Form, { width: 310, height: 200 });
  assert.equal(cardRowOffsetCache.Form.Id, 40);
  assert.equal(cardRowOffsetCache.Form.ParentId, 60);
  assert.equal(cardRowOffsetCache.Form.LastField, 188);
  assert.match(script, /cardBody\.addEventListener\('scroll',[\s\S]*scheduleSvgUpdate\(\[entity\.name\]\)/);
});

test('generated ERD client JavaScript remains syntactically valid', () => {
  assert.doesNotThrow(() => new Function(getEfDiagramClientScript()));
});
