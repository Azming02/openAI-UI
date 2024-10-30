import { createSignal, onMount } from 'solid-js'
import MarkdownIt from 'markdown-it'
import mdKatex from 'markdown-it-katex'
import mdHighlight from 'markdown-it-highlightjs'
import { useClipboard, useEventListener } from 'solidjs-use'
import IconRefresh from './icons/Refresh'
import type { Accessor} from 'solid-js'
import type { ChatMessage } from '@/types'

interface Props {
  role: ChatMessage['role']
  message: Accessor<string> | string
  showRetry?: Accessor<boolean>
  onRetry?: () => void
}

export default ({ role, message, showRetry, onRetry }: Props) => {
  const roleClass = {
    // system: 'bg-gradient-to-r from-gray-300 via-gray-200 to-gray-300',
    // user: 'bg-gradient-to-r from-purple-400 to-yellow-400',
    // assistant: 'bg-gradient-to-r from-yellow-200 via-green-200 to-green-300',
    system: 'system-avatar-url.png',
    user: './public/user.png',
    assistant: './public/pwa-192.png',
  }
  const [source] = createSignal('')
  const { copy, copied } = useClipboard({ source, copiedDuring: 1000 })

  useEventListener('click', (e) => {
    const el = e.target as HTMLElement
    let code = null

    if (el.matches('div > div.copy-btn')) {
      code = decodeURIComponent(el.dataset.code!)
      copy(code)
    }
    if (el.matches('div > div.copy-btn > svg')) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      code = decodeURIComponent(el.parentElement?.dataset.code!)
      copy(code)
    }
  })

  const htmlString = () => {
    const md = MarkdownIt({
      linkify: true,
      breaks: true,
    }).use(mdKatex).use(mdHighlight)
    const fence = md.renderer.rules.fence!
    md.renderer.rules.fence = (...args) => {
      const [tokens, idx] = args
      const token = tokens[idx]
      const rawCode = fence(...args)

      return `<div relative>
      <div data-code=${encodeURIComponent(token.content)} class="copy-btn gpt-copy-btn group">
          <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32"><path fill="currentColor" d="M28 10v18H10V10h18m0-2H10a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z" /><path fill="currentColor" d="M4 18H2V4a2 2 0 0 1 2-2h14v2H4Z" /></svg>
            <div class="group-hover:op-100 gpt-copy-tips">
              ${copied() ? 'Copied' : 'Copy'}
            </div>
      </div>
      ${rawCode}
      </div>`
    }

    if (typeof message === 'function')
      return md.render(message())
    else if (typeof message === 'string')
      return md.render(message)

    return ''
  }
  
  onMount(() => {
    window.scrollTo(0, document.body.scrollHeight)
  })
  
  return (
    // <div class="py-2 -mx-4 px-4 transition-colors md:hover:bg-slate/3">
    <div class="py-2 -mx-4 px-4 md:hover:bg-slate/5">
    <div
      // flex-row-reverse反转位置，将用户角色放置右侧
      // 使用justify-end将内容进行右对齐, 
      class={`flex gap-3 rounded-lg ${role === 'user' ? 'flex-row-reverse justify-end' : ''}`}  
      class:op-75={role === 'user'}
    >
      {/*  头像样式  */}
      {/* <div class={`shrink-0 w-7 h-7 mt-4 rounded-full op-80 ${roleClass[role]}`} /> */}
      {role === 'assistant' || role === 'user' ? (
          <img
            src={roleClass[role]}
            alt="avatar"
            // mt-1 适用于有度弹窗， mt-4 适用于浏览器
            class="shrink-0 w-7 h-7 mt-1 rounded-full op-90"
          />
        ) : (
          <div class={`shrink-0 w-7 h-7 mt-4 rounded-full op-80 ${roleClass[role]}`} />
        )}
      <div
      // ml-auto 将消息文本 推到最右侧， p-1 适用于有度弹窗， 浏览器不需要调整内边距（mt-4）
        class={`message prose break-words overflow-hidden p-1 ${role === 'user' ? 'text-right ml-auto' : ''}`}
        innerHTML={htmlString()}
      />
    </div>
    {showRetry?.() && onRetry && (
      <div class="fie px-2 mb-1">
        <div onClick={onRetry} class="gpt-retry-btn">
          <IconRefresh />
          <span>重试</span>
        </div>
      </div>
    )}
  </div>
  )
}
