/**
 * Two motion primitives the home page leans on, both reduced-motion aware.
 *
 * Neither uses the reveal system in `lib/motion.js` on purpose: a marquee is
 * an endless loop rather than a one-shot entrance, and WordReveal drives its
 * own per-word counter rather than a single IntersectionObserver toggle.
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion as reducedMotion } from '../lib/motion.js'

/**
 * An endlessly scrolling ticker.
 *
 * The track holds two identical groups and translates by exactly -50%, so the
 * seam is invisible and the loop is seamless. There is no visible pause
 * control: the production build has none either, and a button sitting in the
 * band was the only thing on the home page that did not match it. WCAG 2.2.2
 * is still met — the track is paused by CSS on `:hover` and `:focus-within`,
 * which covers pointer and keyboard users without adding a pixel.
 */
export function Marquee({ label, items, duration = 42 }) {
  const trackRef = useRef(null)

  // The duration is written through the CSSOM rather than a `style` attribute:
  // the policy is `style-src 'self'` with no `unsafe-inline`, so an inline
  // style would be blocked outright.
  useEffect(() => {
    trackRef.current?.style.setProperty('--marquee-duration', `${duration}s`)
  }, [duration])

  const group = items.map((item) => (
    <span className="marquee__item" key={item}>
      {item}
    </span>
  ))

  return (
    <div className="marquee">
      {/* Reduced motion is handled by the stylesheet rather than by an
          attribute here, so nothing has to be re-rendered when the preference
          changes and the markup stays identical to the production build. */}
      <div className="marquee__track" ref={trackRef}>
        <div className="marquee__group">{group}</div>
        {/* The duplicate is decorative: the first group already carries the
            text, and announcing it twice would be noise for a screen reader. */}
        <div className="marquee__group" aria-hidden="true">
          {group}
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

/**
 * Headline set one word at a time.
 *
 * Words are pre-marked active whenever motion is reduced or IntersectionObserver
 * is unavailable, so the line is never left half-invisible — the classic
 * failure mode for a staggered entrance that depends on JS to resolve.
 */
export function WordReveal({ lines, as: Tag = 'p' }) {
  const ref = useRef(null)
  const total = lines.reduce((count, line) => count + line.split(' ').length, 0)
  const [activeCount, setActiveCount] = useState(0)
  const [showAll, setShowAll] = useState(() => reducedMotion())

  useEffect(() => {
    setShowAll(reducedMotion() || !('IntersectionObserver' in window))
    if (reducedMotion() || !('IntersectionObserver' in window)) return undefined

    const node = ref.current
    if (!node) return undefined

    const timers = []
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        for (let index = 0; index < total; index += 1) {
          timers.push(window.setTimeout(() => setActiveCount(index + 1), index * 54))
        }
        observer.disconnect()
      },
      { threshold: 0.32 }
    )

    observer.observe(node)
    return () => {
      observer.disconnect()
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [total])

  let seen = 0

  return (
    <Tag className="word-reveal" ref={ref}>
      {lines.map((line) => {
        const words = line.split(' ')
        return (
          <span className="word-reveal__line" key={line}>
            {words.map((word) => {
              const index = seen
              seen += 1
              const on = showAll || index < activeCount
              return (
                <Fragment key={`${word}-${index}`}>
                  <span className={`word-reveal__word${on ? ' is-active' : ''}`}>{word}</span>{' '}
                </Fragment>
              )
            })}
          </span>
        )
      })}
    </Tag>
  )
}
