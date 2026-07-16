// =============================================================================
// mermaid-renderer-svg-id.test.ts -- bug-077: duplicate SVG root id
//
// mmdc defaults every render's SVG root id to the literal "my-svg". With 2+
// diagrams inlined on one HTML page, their id-scoped CSS rules collide and
// bleed across diagrams. This test renders real diagrams through the actual
// mmdc/Chromium pipeline (no mocks — offline, no network: local Chromium +
// local mermaid-cli) and asserts each output SVG has a distinct root id, and
// that the literal "my-svg" never appears.
//
// Run: npx tsx tests/mermaid-renderer-svg-id.test.ts
// Exit: 0 if all assertions pass, 1 (via thrown AssertionError) otherwise.
// =============================================================================

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDiagrams } from '../src/mermaid-renderer.js';

function extractRootId(svg: string): string | undefined {
  const match = svg.match(/<svg\b[^>]*\bid="([^"]+)"/);
  return match?.[1];
}

async function main() {
  const tempDir = await mkdtemp(join(tmpdir(), 'svg-plot-test-'));
  try {
    // (1) Two DIFFERENT diagrams -> distinct hash -> must get distinct ids.
    const distinct = await renderDiagrams(
      [
        { name: 'diagram-a', mermaid: 'flowchart TD\n  A[Start] --> B[End]' },
        { name: 'diagram-b', mermaid: 'flowchart TD\n  X[Foo] --> Y[Bar]' },
      ],
      tempDir,
      'light',
    );
    assert.equal(distinct.length, 2, 'renderDiagrams returned 2 outputs for 2 inputs');

    const idA = extractRootId(distinct[0].svg);
    const idB = extractRootId(distinct[1].svg);
    assert.ok(idA, 'diagram-a SVG has a root id attribute');
    assert.ok(idB, 'diagram-b SVG has a root id attribute');
    assert.notEqual(idA, idB, 'two different diagrams get two different root ids');
    assert.notEqual(idA, 'my-svg', 'diagram-a root id is not the mmdc default "my-svg"');
    assert.notEqual(idB, 'my-svg', 'diagram-b root id is not the mmdc default "my-svg"');
    assert.ok(!distinct[0].svg.includes('id="my-svg"'), 'diagram-a SVG has no literal id="my-svg"');
    assert.ok(!distinct[1].svg.includes('id="my-svg"'), 'diagram-b SVG has no literal id="my-svg"');

    // (2) Two IDENTICAL diagrams in the same call (same hash) -> the call-order
    //     index must still disambiguate them.
    const duplicateSource = 'flowchart TD\n  P[Same] --> Q[Content]';
    const duplicates = await renderDiagrams(
      [
        { name: 'dup-1', mermaid: duplicateSource },
        { name: 'dup-2', mermaid: duplicateSource },
      ],
      tempDir,
      'light',
    );
    const idDup1 = extractRootId(duplicates[0].svg);
    const idDup2 = extractRootId(duplicates[1].svg);
    assert.ok(idDup1, 'dup-1 SVG has a root id attribute');
    assert.ok(idDup2, 'dup-2 SVG has a root id attribute');
    assert.notEqual(
      idDup1,
      idDup2,
      'two IDENTICAL-content diagrams in one call still get distinct root ids (index disambiguates)',
    );

    console.log('All assertions passed (mermaid-renderer-svg-id.test.ts)');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
