import assert from 'node:assert/strict'
import test from 'node:test'
import { extractReferenceMetadata, __test__ } from '../src/reference-extractor.js'

const SAMPLE_PAPER = `Deep Learning for Radar-Based Moisture Detection in Tobacco

Author: Zhang Wei, Li Ming, Wang Fang

Department of Electronic Engineering, Xidian University

Abstract: This paper presents a novel deep learning approach for moisture
detection in tobacco using 80GHz millimeter-wave radar. The proposed method
achieves 95.2% accuracy on a dataset of 10,000 samples.

Keywords: millimeter-wave radar, moisture detection, deep learning, tobacco, FMCW

1. Introduction
Tobacco moisture content is a critical parameter...

2. Methodology
2.1 Radar Signal Processing
The FMCW radar transmits...

2.2 Deep Learning Model
We propose a CNN-LSTM hybrid model...

3. Results
The experimental results show...

4. Conclusion
This paper demonstrated...
`

test('extractReferenceMetadata extracts title', () => {
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  assert.ok(meta.title.includes('Deep Learning') || meta.title.includes('Radar'))
  assert.ok(meta.title.length > 5)
})

test('extractReferenceMetadata extracts authors', () => {
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  assert.ok(meta.authors.length >= 1)
  assert.ok(meta.authors.some((a) => /Zhang|Wei|Li|Ming|Wang|Fang/.test(a)))
})

test('extractReferenceMetadata extracts year', () => {
  const meta = extractReferenceMetadata('Published: 2024\n\nTitle: Test\n\nAbstract: test abstract here.')
  assert.equal(meta.year, 2024)
})

test('extractReferenceMetadata extracts abstract', () => {
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  assert.ok(meta.abstract.length > 20)
  assert.ok(meta.abstract.includes('millimeter-wave') || meta.abstract.includes('moisture'))
})

test('extractReferenceMetadata extracts keywords', () => {
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  assert.ok(meta.keywords.length >= 3)
  assert.ok(meta.keywords.includes('millimeter-wave radar'))
})

test('extractReferenceMetadata extracts DOI', () => {
  const meta = extractReferenceMetadata('Title: Test\nDOI: 10.1109/TIM.2024.1234567\nAbstract: test.')
  assert.equal(meta.doi, '10.1109/TIM.2024.1234567')
})

test('extractReferenceMetadata extracts sections', () => {
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  assert.ok(meta.sections.length >= 3)
  assert.ok(meta.sections.some((s) => s.title === 'Introduction'))
  assert.ok(meta.sections.some((s) => s.number === '2.1'))
})

test('extractReferenceMetadata handles empty text', () => {
  const meta = extractReferenceMetadata('')
  assert.equal(meta.title, '')
  assert.deepEqual(meta.authors, [])
  assert.equal(meta.year, 0)
  assert.equal(meta.abstract, '')
  assert.deepEqual(meta.keywords, [])
})

test('extractReferenceMetadata confidence values are finite', () => {
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  for (const key of Object.keys(meta.confidence)) {
    assert.equal(typeof meta.confidence[key], 'number')
    assert.ok(Number.isFinite(meta.confidence[key]))
  }
})

test('extractReferenceMetadata result is lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const meta = extractReferenceMetadata(SAMPLE_PAPER)
  assert.ok(isLosslessJson(meta), 'metadata must be lossless JSON')
})

test('__test__.extractTitle finds explicit title marker', () => {
  assert.equal(__test__.extractTitle('Title: My Paper Title\n\nAuthor: Test'), 'My Paper Title')
})

test('__test__.extractYear returns 0 for no year', () => {
  assert.equal(__test__.extractYear('No year here'), 0)
})
