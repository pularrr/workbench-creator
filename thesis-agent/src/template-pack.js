/**
 * Template pack loader & validator (P1 · v0.5).
 *
 * A template pack defines the outline structure (sections + writing-logic
 * steps) for a specific degree type / institution / venue. Packs replace the
 * single hardcoded master template and can be imported from JSON.
 *
 * Pack schema (see docs/template-pack-schema.json):
 * {
 *   id: string,              // unique, kebab-case
 *   name: string,            // display name
 *   degreeType: 'bachelor'|'master'|'doctor'|'conference',
 *   targetWords: number,     // default total words
 *   sections: [{
 *     title: string,
 *     ratio: number,         // 0..1, sums to ~1
 *     objective: string,
 *     logic: [{ purpose: string, transition?: string }]
 *   }]
 * }
 */

import { readFile } from 'node:fs/promises'

const DEGREE_TYPES = new Set(['bachelor', 'master', 'doctor', 'conference'])

// ---------------------------------------------------------------------------
// Built-in template packs
// ---------------------------------------------------------------------------
const GENERIC_MASTER = {
  id: 'generic-master',
  name: '通用硕士学位论文',
  degreeType: 'master',
  targetWords: 30000,
  sections: [
    { title: '绪论', ratio: 0.1, objective: '说明研究背景、意义、问题、研究内容与论文组织。', logic: [{ purpose: '从应用或学术背景引出问题' }, { purpose: '说明研究意义和现实价值' }, { purpose: '界定研究问题与目标' }, { purpose: '概括研究内容、方法与创新点' }, { purpose: '说明论文结构安排' }] },
    { title: '国内外研究现状与相关工作', ratio: 0.16, objective: '系统比较现有工作，识别不足并引出本文切入点。', logic: [{ purpose: '界定研究范围和评价维度' }, { purpose: '按技术路线或观点分类代表性工作' }, { purpose: '横向比较同类方法的能力、代价和适用场景' }, { purpose: '纵向梳理关键技术或观点的演进' }, { purpose: '总结现有工作的不足、争议和证据缺口' }, { purpose: '说明本文与现有工作的关系及研究切入点' }] },
    { title: '理论基础与关键技术', ratio: 0.1, objective: '解释后续方法和系统设计所依赖的概念、模型与技术。', logic: [{ purpose: '定义核心术语与符号' }, { purpose: '说明关键理论或算法原理' }, { purpose: '比较可选技术并解释选型' }, { purpose: '建立理论基础与本文方案的对应关系' }] },
    { title: '问题分析与需求设计', ratio: 0.1, objective: '将研究问题转化为明确需求、约束和评价目标。', logic: [{ purpose: '描述研究对象和使用场景' }, { purpose: '分析现有流程及关键痛点' }, { purpose: '提出功能需求和非功能需求' }, { purpose: '说明约束、假设和验收指标' }] },
    { title: '方法或系统总体设计', ratio: 0.16, objective: '给出总体方案、模块关系、数据流和核心方法。', logic: [{ purpose: '提出总体设计目标和原则' }, { purpose: '说明系统架构或方法框架' }, { purpose: '解释模块职责与交互关系' }, { purpose: '详细说明核心算法或处理流程' }, { purpose: '分析关键设计选择及其合理性' }] },
    { title: '系统实现或方法实现', ratio: 0.12, objective: '说明关键模块、算法和工程实现如何落地。', logic: [{ purpose: '交代开发与运行环境' }, { purpose: '按模块说明实现过程' }, { purpose: '解释关键数据结构、接口和算法' }, { purpose: '说明异常、性能和一致性处理' }, { purpose: '总结实现与设计目标的对应关系' }] },
    { title: '实验设计、结果与讨论', ratio: 0.2, objective: '用可复现的实验验证方案效果并讨论边界。', logic: [{ purpose: '提出实验问题和评价假设' }, { purpose: '说明数据集、环境、参数与对比基线' }, { purpose: '定义评价指标和实验步骤' }, { purpose: '客观呈现主要结果' }, { purpose: '进行横向对比、消融或敏感性分析' }, { purpose: '解释结果原因、异常与限制' }, { purpose: '总结实验结论和适用边界' }] },
    { title: '总结与展望', ratio: 0.06, objective: '总结研究贡献、限制和后续工作。', logic: [{ purpose: '回顾研究问题和主要工作' }, { purpose: '概括核心结果和贡献' }, { purpose: '诚实说明局限性' }, { purpose: '提出有依据的后续研究方向' }] },
  ],
}

const GENERIC_BACHELOR = {
  id: 'generic-bachelor',
  name: '通用本科毕业论文',
  degreeType: 'bachelor',
  targetWords: 12000,
  sections: [
    { title: '绪论', ratio: 0.12, objective: '说明选题背景、研究意义和主要工作。', logic: [{ purpose: '介绍选题背景和来源' }, { purpose: '说明研究目的和意义' }, { purpose: '概括论文主要工作和结构' }] },
    { title: '相关技术与理论基础', ratio: 0.15, objective: '介绍课题涉及的关键技术和理论。', logic: [{ purpose: '介绍相关技术发展现状' }, { purpose: '说明核心理论和工具' }, { purpose: '比较可选方案并说明选型理由' }] },
    { title: '需求分析与总体设计', ratio: 0.18, objective: '分析需求并给出系统总体设计。', logic: [{ purpose: '分析功能需求和非功能需求' }, { purpose: '给出系统总体架构' }, { purpose: '说明模块划分和职责' }, { purpose: '设计关键数据结构和接口' }] },
    { title: '详细设计与实现', ratio: 0.3, objective: '详细说明各模块的设计与实现。', logic: [{ purpose: '说明开发环境和工具' }, { purpose: '按模块详细说明实现过程' }, { purpose: '展示关键代码或算法' }, { purpose: '说明遇到的问题和解决方法' }] },
    { title: '系统测试与结果分析', ratio: 0.15, objective: '测试系统功能并分析结果。', logic: [{ purpose: '设计测试用例和测试环境' }, { purpose: '执行功能测试和性能测试' }, { purpose: '分析测试结果和存在的问题' }] },
    { title: '总结与展望', ratio: 0.1, objective: '总结工作并展望后续改进。', logic: [{ purpose: '总结论文主要工作和成果' }, { purpose: '说明不足之处' }, { purpose: '提出后续改进方向' }] },
  ],
}

const IEEE_CONFERENCE = {
  id: 'ieee-conference',
  name: 'IEEE 会议论文',
  degreeType: 'conference',
  targetWords: 6000,
  sections: [
    { title: 'Introduction', ratio: 0.15, objective: 'Motivate the problem and state contributions.', logic: [{ purpose: 'Introduce the research area and its importance' }, { purpose: 'Identify the gap or challenge' }, { purpose: 'State the paper contributions and outline' }] },
    { title: 'Related Work', ratio: 0.12, objective: 'Position the work against prior art.', logic: [{ purpose: 'Survey closely related approaches' }, { purpose: 'Compare limitations' }, { purpose: 'Highlight the difference of this work' }] },
    { title: 'Methodology', ratio: 0.28, objective: 'Describe the proposed method in detail.', logic: [{ purpose: 'Define the problem and notation' }, { purpose: 'Present the overall framework' }, { purpose: 'Detail each component or algorithm' }, { purpose: 'Provide theoretical analysis if applicable' }] },
    { title: 'Experiments', ratio: 0.3, objective: 'Validate the method with reproducible experiments.', logic: [{ purpose: 'Describe datasets and baselines' }, { purpose: 'Define evaluation metrics' }, { purpose: 'Present main results' }, { purpose: 'Run ablation and sensitivity studies' }, { purpose: 'Discuss findings and limitations' }] },
    { title: 'Conclusion', ratio: 0.15, objective: 'Summarize and outline future work.', logic: [{ purpose: 'Recap the main contribution and result' }, { purpose: 'Note limitations' }, { purpose: 'Suggest future directions' }] },
  ],
}

const BUILTIN_PACKS = [GENERIC_MASTER, GENERIC_BACHELOR, IEEE_CONFERENCE]

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function validateTemplatePack(pack) {
  const errors = []
  if (!pack || typeof pack !== 'object') { errors.push('pack must be an object'); return { valid: false, errors } }
  if (typeof pack.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(pack.id)) errors.push('pack.id must be a kebab-case string')
  if (typeof pack.name !== 'string' || pack.name.trim().length === 0) errors.push('pack.name must be a non-empty string')
  if (!DEGREE_TYPES.has(pack.degreeType)) errors.push(`pack.degreeType must be one of: ${[...DEGREE_TYPES].join(', ')}`)
  if (typeof pack.targetWords !== 'number' || pack.targetWords < 0 || !Number.isFinite(pack.targetWords)) errors.push('pack.targetWords must be a non-negative finite number')
  if (!Array.isArray(pack.sections) || pack.sections.length === 0) { errors.push('pack.sections must be a non-empty array'); return { valid: errors.length === 0, errors } }
  let ratioSum = 0
  pack.sections.forEach((section, si) => {
    const prefix = `pack.sections[${si}]`
    if (typeof section.title !== 'string' || section.title.trim().length === 0) errors.push(`${prefix}.title must be a non-empty string`)
    if (typeof section.ratio !== 'number' || section.ratio < 0 || section.ratio > 1 || !Number.isFinite(section.ratio)) errors.push(`${prefix}.ratio must be a number in [0,1]`)
    else ratioSum += section.ratio
    if (typeof section.objective !== 'string') errors.push(`${prefix}.objective must be a string`)
    if (!Array.isArray(section.logic) || section.logic.length === 0) { errors.push(`${prefix}.logic must be a non-empty array`); return }
    section.logic.forEach((step, li) => {
      if (typeof step.purpose !== 'string' || step.purpose.trim().length === 0) errors.push(`${prefix}.logic[${li}].purpose must be a non-empty string`)
    })
  })
  if (Math.abs(ratioSum - 1) > 0.05) errors.push(`pack.sections ratios should sum to ~1 (got ${ratioSum.toFixed(3)})`)
  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all built-in template packs (cloned, safe to mutate). */
export function listBuiltinPacks() {
  return BUILTIN_PACKS.map((pack) => structuredClone(pack))
}

/** Get a built-in pack by id (or null). */
export function getBuiltinPack(id) {
  const found = BUILTIN_PACKS.find((pack) => pack.id === id)
  return found ? structuredClone(found) : null
}

/**
 * Load and validate a template pack from a JSON file.
 * @param {string} filePath - absolute or relative path to a .json pack
 * @returns {Promise<object>} validated pack
 * @throws if file is missing, invalid JSON, or fails schema validation
 */
export async function loadTemplatePack(filePath) {
  const raw = await readFile(filePath, 'utf8')
  let pack
  try { pack = JSON.parse(raw) } catch (error) { throw new Error(`Template pack is not valid JSON: ${error.message}`) }
  const { valid, errors } = validateTemplatePack(pack)
  if (!valid) throw new Error(`Invalid template pack:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  return structuredClone(pack)
}

/**
 * Expand a template pack into an outline array compatible with setPlan.
 * @param {object} pack - validated template pack
 * @param {number} [targetWords] - override total target words
 * @returns {Array<{title,objective,targetWords,locked,logic:Array<{purpose,transition,targetWords}>}>}
 */
export function expandTemplatePack(pack, targetWords) {
  const total = Math.max(0, Math.round(Number(targetWords) || pack.targetWords || 30000))
  return pack.sections.map((section) => {
    const sectionWords = Math.max(0, Math.round(total * section.ratio))
    const logicWords = section.logic.length > 0 ? Math.floor(sectionWords / section.logic.length) : 0
    return {
      title: section.title,
      objective: section.objective || '',
      targetWords: sectionWords,
      locked: false,
      logic: section.logic.map((step, index) => ({
        purpose: step.purpose,
        transition: typeof step.transition === 'string' ? step.transition : (index === 0 ? '' : '承接上一论证动作并推进本节目标。'),
        targetWords: index === section.logic.length - 1
          ? Math.max(0, sectionWords - logicWords * (section.logic.length - 1))
          : logicWords,
      })),
    }
  })
}
