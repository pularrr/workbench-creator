export function renderMarkdown(project, options = {}) {
  const title = options.title || project.title || project.name
  const blocks = [...(project.manuscriptBlocks || [])].sort((a, b) => a.order - b.order)
  const body = blocks.map((block) => block.markdown || '').filter(Boolean).join('\n\n')
  return `# ${title}\n\n${body}`.trimEnd() + '\n'
}
export function renderPlainText(project, options = {}) { return renderMarkdown(project, options).replace(/^#+\s*/gm, '') }

// Core exporters are task-neutral. Domain plugins can register additional
// exporters (for example thesis DOCX/PDF or patent DOCX/PDF) through the
// exporter registry without changing WorkbenchRuntime.
export const markdownExporter = {
  id: 'core-markdown-exporter', name: 'Markdown 导出', format: 'markdown', taskType: '*',
  description: 'Export the document as Markdown text.',
  async export(project, input = {}) {
    return { format: 'markdown', filename: `${input.filename || project.title || project.name}.md`, mimeType: 'text/markdown; charset=utf-8', content: renderMarkdown(project, input) }
  },
}

export const textExporter = {
  id: 'core-text-exporter', name: '纯文本导出', format: 'text', taskType: '*',
  description: 'Export the document as plain text.',
  async export(project, input = {}) {
    return { format: 'text', filename: `${input.filename || project.title || project.name}.txt`, mimeType: 'text/plain; charset=utf-8', content: renderPlainText(project, input) }
  },
}
