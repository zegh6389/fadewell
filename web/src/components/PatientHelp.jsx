/**
 * An anchored chat preview. Messages stay in component state only.
 *
 * Uses a real `<dialog>` with `showModal()` so focus trapping, Escape and the
 * backdrop are handled by the platform rather than reimplemented. The launcher
 * button is kept mounted after the dialog closes so focus returns to it.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { support } from '../lib/content.js'
import { BrandMark, IconArrow } from './Icons.jsx'

const LINKS = [
  ['Start my intake', '/care'],
  ['Understand the process', '/service'],
  ['Prepare for my visit', '/patient-info'],
  ['Clinical standards', '/clinicians'],
  ['Billing or cancellation help', '/refund-policy']
]

export function PatientHelp() {
  const dialog = useRef(null)
  const conversation = useRef(null)
  const input = useRef(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState([])

  useEffect(() => {
    if (!open) return
    conversation.current.scrollTop = conversation.current.scrollHeight
  }, [messages, open])

  function sendMessage(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setMessages((current) => [...current,
      { role: 'user', text },
      { role: 'assistant', text: 'This is a chat preview. Your message stays on this page and has not been sent to our team. Use the links above, or contact our team below for help.' }
    ])
    setDraft('')
    input.current?.focus()
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
            <div><h2 id="help-title">MmjGreen care chat</h2><p id="help-preview-note">UI preview · No messages sent</p></div>
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
            <strong>Let’s find your next step.</strong>
            <p>Have a question about your medical card? Type below, or choose a topic to explore.</p>
          </div>
          <nav className="help__links" aria-label="Help topics">
          {LINKS.map(([label, to]) => (
            <Link key={to} to={to} onClick={() => dialog.current?.close()}>
              {label}
            </Link>
          ))}
          </nav>
          <div className="help__messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => (
              <div className={`help__bubble help__bubble--${message.role}`} key={index}>
                <span className="sr-only">{message.role === 'user' ? 'You: ' : 'Chat preview: '}</span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="help__footer">
          <form className="help__composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="help-message">Your message</label>
            <input ref={input} id="help-message" name="message" type="text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type your message…" maxLength={1000} autoComplete="off" />
            <button type="submit" className="help__send" aria-label="Send message" disabled={!draft.trim()}><IconArrow size={20} /></button>
          </form>
          <div className="help__direct"><a href={support.tel}>Call our team</a><span aria-hidden="true">·</span><a href={support.mailto}>Email us</a></div>
          <p className="help__urgent">For emergencies, call your local emergency number.</p>
        </div>
      </dialog>
    </>
  )
}
