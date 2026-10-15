/**
 * The care guide ("Jhon") launcher.
 *
 * Rebuilt from the production bundle that shipped to Vercel on 2026-10-14: same
 * class names, same copy, same structure, so `styles/recovered.css` applies as
 * written.
 *
 * Replies come from `POST /api/v1/chat`. The browser never invents an answer and
 * never decides what is safe to say — the service owns both the reply and the
 * `meta.safety` flag, and the browser only uses that flag to skip the typing
 * delay on an urgent reply so crisis guidance appears without ceremony.
 *
 * Uses a real `<dialog>` with `showModal()` so focus trapping, Escape and the
 * backdrop are handled by the platform rather than reimplemented. The launcher
 * button is kept mounted after the dialog closes so focus returns to it.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { postChat } from '../lib/api.js'
import { support } from '../lib/content.js'
import { BrandMark, IconArrow } from './Icons.jsx'

/** Shortcuts to the pages the guide cannot usefully answer for. */
const TOPICS = [
  ['Start my intake', '/patient'],
  ['Understand the process', '/service'],
  ['Prepare for my visit', '/patient-info'],
  ['Clinical standards', '/clinicians'],
  ['Billing or cancellation help', '/refund-policy']
]

const GREETING =
  "Hey, I'm Jhon, MmjGreen's AI care guide. Ask me about costs, state coverage, or getting ready for your visit. We can take it one step at a time."

const SUGGESTIONS = [
  'What does the consultation cost?',
  'Which states do you serve?',
  'What should I bring to my visit?',
  'How long does the process take?'
]

export function PatientHelp() {
  const dialog = useRef(null)
  const conversation = useRef(null)
  const input = useRef(null)
  const conversationState = useRef({ history: [] })
  const inFlight = useRef(false)
  const mounted = useRef(true)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (open) conversation.current.scrollTop = conversation.current.scrollHeight
  }, [messages, open, typing])

  async function send(event, preset) {
    event?.preventDefault()
    const text = (preset ?? draft).trim()
    if (!text || inFlight.current) return

    inFlight.current = true
    const startedAt = Date.now()
    setMessages((current) => [...current, { role: 'user', text }])
    setDraft('')
    setTyping(true)
    input.current?.focus()

    try {
      const result = await postChat({ message: text, state: conversationState.current })

      // Hold the reply on screen briefly so it reads as a conversation, unless
      // the service flagged it as a safety response — those should not be paced.
      if (!result.meta?.safety && mounted.current) {
        const wait = Math.min(3200, 1000 + result.reply.length * 12) + Math.random() * 400
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait - (Date.now() - startedAt))))
      }

      if (!mounted.current) return
      conversationState.current = result.state
      setMessages((current) => [...current, { role: 'assistant', text: result.reply }])
    } catch {
      if (!mounted.current) return
      setMessages((current) => [...current, {
        role: 'assistant',
        text: `I'm not answering right now because the connection failed. You can try again, call our team on ${support.phone}, or email ${support.email}.`
      }])
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setTyping(false)
        if (dialog.current?.open) input.current?.focus()
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className="help-launcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="patient-support"
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
          input.current?.focus()
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />
          <path d="M7 10h9M7 14h5" />
        </svg>
        <span>Need help?</span>
      </button>

      <dialog
        ref={dialog}
        id="patient-support"
        className="help"
        aria-labelledby="help-title"
        aria-describedby="help-preview-note"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target !== dialog.current) return
          const box = dialog.current.getBoundingClientRect()
          if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current.close()
        }}
      >
        <header className="help__head">
          <div className="help__identity">
            <BrandMark size={40} />
            <div>
              <h2 id="help-title">MmjGreen care chat</h2>
              <p id="help-preview-note">Jhon · AI care guide</p>
            </div>
          </div>
          <button
            type="button"
            className="help__close"
            aria-label="Close help"
            onClick={() => dialog.current?.close()}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="help__conversation" ref={conversation}>
          <div className="help__bubble help__bubble--assistant">
            <strong>Hi, I'm Jhon.</strong>
            <p>{GREETING}</p>
          </div>

          {messages.length === 0 && (
            <nav className="help__links" aria-label="Suggested questions">
              {SUGGESTIONS.map((question) => (
                <button key={question} type="button" onClick={(event) => send(event, question)} disabled={typing}>
                  {question}
                </button>
              ))}
            </nav>
          )}

          <nav className="help__links" aria-label="Help topics">
            {TOPICS.map(([label, to]) => (
              <Link key={to} to={to} onClick={() => dialog.current?.close()}>
                {label}
              </Link>
            ))}
          </nav>

          <div className="help__messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => (
              <div className={`help__bubble help__bubble--${message.role}`} key={index}>
                <span className="sr-only">{message.role === 'user' ? 'You: ' : 'Jhon: '}</span>
                <p>{message.text}</p>
              </div>
            ))}

            {typing && (
              <div className="help__bubble help__bubble--assistant">
                <p className="help__typing" role="status" aria-label="Jhon is typing">
                  <span className="sr-only">Jhon is typing</span>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="help__footer">
          <form className="help__composer" onSubmit={send}>
            <label className="sr-only" htmlFor="help-message">Your message</label>
            <input
              ref={input}
              id="help-message"
              name="message"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type your message…"
              maxLength={1000}
              autoComplete="off"
            />
            <button type="submit" className="help__send" aria-label="Send message" disabled={!draft.trim() || typing}>
              <IconArrow size={20} />
            </button>
          </form>

          <div className="help__direct">
            <a href={support.tel}>Call our team</a>
            <span aria-hidden="true">·</span>
            <a href={support.mailto}>Email us</a>
          </div>

          <p className="help__privacy">
            Jhon is an AI guide using our published information. This is not medical advice, and what
            you type is not saved.
          </p>
          <p className="help__urgent">For emergencies, call your local emergency number.</p>
        </div>
      </dialog>
    </>
  )
}