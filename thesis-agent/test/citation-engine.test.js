import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCitations, scanManuscript, autoNumber, findOrphans, generateCaptionList } from '../src/citation-engine.js'

const SAMPLE_MANUSCRIPT = `# 论文正文

## 1. 引言

毫米波雷达技术在工业检测中应用广泛，如图1所示。

## 2. 方法

### 2.1 系统架构

系统整体架构如图1所示，包括雷达模块、信号处理模块和深度学习模块。

![系统架构](architecture.png)
图1 系统整体架构图

实验数据如表1所示。

表1 实验数据统计

| 方法 | 精度 | 召回率 |
| --- | --- | --- |
| 方法A | 0.95 | 0.90 |

### 2.2 信号处理

信号处理流程如图2所示。

![信号处理](signal.png)
图2 信号处理流程图

距离计算公式如公式(1)所示：

$$R = \\frac{c \\cdot \\tau}{2}$$ (1)

## 3. 结果

如表1所示，方法A取得了最优性能。图3展示了不同方法的对比结果。

![对比结果](comparison.png)
图3 不同方法对比结果

## 4. 结论

本文提出了一种新方法，如图1和图2所示，实验结果见表1。
`

test('scanManuscript finds figure definitions', () => {
  const scan = scanManuscript(SAMPLE_MANUSCRIPT)
  assert.ok(scan.definitions.figure.length >= 3)
  assert.ok(scan.definitions.figure.some((d) => d.number === '1'))
  assert.ok(scan.definitions.figure.some((d) => d.number === '2'))
  assert.ok(scan.definitions.figure.some((d) => d.number === '3'))
})

test('scanManuscript finds table definitions', () => {
  const scan = scanManuscript(SAMPLE_MANUSCRIPT)
  assert.ok(scan.definitions.table.length >= 1)
  assert.ok(scan.definitions.table.some((d) => d.number === '1'))
})

test('scanManuscript finds figure references', () => {
  const scan = scanManuscript(SAMPLE_MANUSCRIPT)
  assert.ok(scan.references.figure.length >= 3)
})

test('scanManuscript finds table references', () => {
  const scan = scanManuscript(SAMPLE_MANUSCRIPT)
  assert.ok(scan.references.table.length >= 2)
})

test('autoNumber assigns sequential numbers', () => {
  const scan = scanManuscript(SAMPLE_MANUSCRIPT)
  const result = autoNumber(scan)
  assert.equal(result.counters.figure, 3)
  assert.equal(result.counters.table, 1)
  assert.equal(result.mapping.figure['1'], '1')
  assert.equal(result.mapping.figure['2'], '2')
  assert.equal(result.mapping.figure['3'], '3')
})

test('findOrphans detects orphan references', () => {
  const text = '如图5所示，这是一个不存在的图。\n\n图1 存在的图'
  const scan = scanManuscript(text)
  const orphans = findOrphans(scan)
  assert.ok(orphans.references.some((r) => r.number === '5'))
})

test('findOrphans detects orphan definitions', () => {
  const text = '图1 这个图没有被引用\n\n正文内容没有提到图。'
  const scan = scanManuscript(text)
  const orphans = findOrphans(scan)
  assert.ok(orphans.definitions.some((d) => d.number === '1'))
})

test('generateCaptionList returns sorted figures', () => {
  const scan = scanManuscript(SAMPLE_MANUSCRIPT)
  const list = generateCaptionList(scan)
  assert.ok(list.figures.length >= 3)
  assert.equal(list.figures[0].number, '1')
  assert.ok(list.tables.length >= 1)
})

test('analyzeCitations returns complete analysis', () => {
  const result = analyzeCitations(SAMPLE_MANUSCRIPT)
  assert.ok(result.scan)
  assert.ok(result.numbering)
  assert.ok(result.orphans)
  assert.ok(result.captionList)
  assert.ok(result.stats)
  assert.equal(typeof result.stats.figures.defined, 'number')
  assert.ok(Number.isFinite(result.stats.figures.defined))
})

test('analyzeCitations stats are correct', () => {
  const result = analyzeCitations(SAMPLE_MANUSCRIPT)
  assert.ok(result.stats.figures.defined >= 3)
  assert.ok(result.stats.figures.referenced >= 3)
  assert.ok(result.stats.tables.defined >= 1)
  assert.ok(result.stats.tables.referenced >= 1)
})

test('scanManuscript handles empty text', () => {
  const scan = scanManuscript('')
  assert.deepEqual(scan.definitions.figure, [])
  assert.deepEqual(scan.definitions.table, [])
  assert.deepEqual(scan.references.figure, [])
  assert.equal(scan.totalLines, 1)
})

test('analyzeCitations result is lossless JSON', async () => {
  const { isLosslessJson } = await import('../src/lossless.js')
  const result = analyzeCitations(SAMPLE_MANUSCRIPT)
  assert.ok(isLosslessJson(result), 'citation analysis must be lossless JSON')
})

test('scanManuscript detects English figure captions', () => {
  const text = 'Figure 1: System Architecture\n\nAs shown in Figure 1, the system...'
  const scan = scanManuscript(text)
  assert.ok(scan.definitions.figure.some((d) => d.number === '1'))
  assert.ok(scan.references.figure.some((r) => r.number === '1'))
})

test('scanManuscript detects English table captions', () => {
  const text = 'Table 1: Experimental Results\n\nAs shown in Table 1...'
  const scan = scanManuscript(text)
  assert.ok(scan.definitions.table.some((d) => d.number === '1'))
  assert.ok(scan.references.table.some((r) => r.number === '1'))
})
