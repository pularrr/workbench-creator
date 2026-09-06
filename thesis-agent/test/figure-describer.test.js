import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createFigureDescriber, describeFigure, describeFigures, __test__ } from '../src/figure-describer.js'

test('createFigureDescriber defaults to fallback mode', () => {
  const describer = createFigureDescriber()
  assert.equal(describer.mode, 'fallback')
  assert.equal(describer.model, 'gpt-4o-mini')
})

test('createFigureDescriber accepts multimodal config', () => {
  const describer = createFigureDescriber({ mode: 'multimodal', apiKey: 'sk-test', model: 'gpt-4o' })
  assert.equal(describer.mode, 'multimodal')
  assert.equal(describer.apiKey, 'sk-test')
  assert.equal(describer.model, 'gpt-4o')
})

test('describeFigure fallback with caption produces description', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fig-desc-'))
  const imgPath = path.join(dir, 'fig1.png')
  // Create a minimal valid PNG (1x1 pixel)
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(imgPath, pngHeader)
  const describer = createFigureDescriber({ mode: 'fallback' })
  const result = await describeFigure(describer, imgPath, {
    caption: '系统架构图',
    figureNumber: '1',
    surroundingText: '图1展示了系统的整体架构，包括雷达模块、信号处理模块和深度学习模块。',
  })
  assert.equal(typeof result.description, 'string')
  assert.ok(result.description.length > 0)
  assert.ok(result.description.includes('图 1') || result.description.includes('图注'))
  assert.equal(result.mode, 'fallback')
  assert.ok(Number.isFinite(result.confidence))
})

test('describeFigure fallback without context produces basic description', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fig-nocontext-'))
  const imgPath = path.join(dir, 'fig2.png')
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(imgPath, pngHeader)
  const describer = createFigureDescriber({ mode: 'fallback' })
  const result = await describeFigure(describer, imgPath, {})
  assert.equal(typeof result.description, 'string')
  assert.ok(result.description.length > 0)
})

test('describeFigure multimodal without apiKey falls back to error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fig-mm-'))
  const imgPath = path.join(dir, 'fig3.png')
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(imgPath, pngHeader)
  const describer = createFigureDescriber({ mode: 'multimodal', apiKey: '' })
  const result = await describeFigure(describer, imgPath, { caption: 'test' })
  // Should return error mode description, not throw
  assert.equal(result.mode, 'error')
  assert.ok(result.description.includes('失败') || result.description.includes('apiKey'))
})

test('describeFigures batch processes multiple figures', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fig-batch-'))
  const figures = []
  for (let i = 0; i < 2; i++) {
    const imgPath = path.join(dir, `fig${i}.png`)
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await writeFile(imgPath, pngHeader)
    figures.push({ path: imgPath, context: { caption: `图${i + 1}`, figureNumber: String(i + 1) } })
  }
  const describer = createFigureDescriber({ mode: 'fallback' })
  const results = await describeFigures(describer, figures)
  assert.equal(results.length, 2)
  for (const r of results) {
    assert.equal(typeof r.description, 'string')
    assert.ok(Number.isFinite(r.confidence))
  }
})

test('__test__.inferMimeType maps extensions correctly', () => {
  assert.equal(__test__.inferMimeType('test.png'), 'image/png')
  assert.equal(__test__.inferMimeType('test.jpg'), 'image/jpeg')
  assert.equal(__test__.inferMimeType('test.jpeg'), 'image/jpeg')
  assert.equal(__test__.inferMimeType('test.webp'), 'image/webp')
  assert.equal(__test__.inferMimeType('test.unknown'), 'image/png')
})

test('__test__.buildPrompt includes context', () => {
  const prompt = __test__.buildPrompt({ caption: '测试图注', figureNumber: '3', surroundingText: '上下文内容' })
  assert.ok(prompt.includes('测试图注'))
  assert.ok(prompt.includes('图 3'))
  assert.ok(prompt.includes('上下文内容'))
})

test('figure describer results are lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fig-lossless-'))
  const imgPath = path.join(dir, 'fig.png')
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(imgPath, pngHeader)
  const describer = createFigureDescriber({ mode: 'fallback' })
  const result = await describeFigure(describer, imgPath, { caption: 'test' })
  assert.ok(isLosslessJson(result), 'figure description must be lossless JSON')
})
