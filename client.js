window.__ModuleLoader__.load({
  id: 'dsh-workbench-core-conversation-bridge',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    // The local workbench is allowed to submit to DSH only when it was opened
    // from loopback.  It cannot call a model or a provider API itself.
    const isWorkbenchOrigin = (origin) => /^https?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?$/u.test(origin)

    function WorkbenchConversationBridge({ sessionId, inputActions }) {
      React.useEffect(() => {
        const onMessage = (event) => {
          const request = event.data
          if (!isWorkbenchOrigin(event.origin) || request?.source !== 'dsh-workbench-core' || request?.type !== 'submit-prompt') return
          if (!sessionId || request.sessionId !== sessionId || typeof request.prompt !== 'string' || request.prompt.length === 0 || request.prompt.length > 30000) return
          inputActions.setDraft(request.prompt)
          inputActions.submit()
          event.source?.postMessage({ source: 'dsh-workbench-core', type: 'prompt-accepted' }, event.origin)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [sessionId, inputActions])
      return null
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: 'dsh-workbench-core-conversation-bridge',
        order: 90,
      }, WorkbenchConversationBridge))
    }

    exports.inject = ['slots', 'uiSession']
    exports.apply = apply
    return module.exports
  },
})
