/**
 * FadeWell — motion engine.
 *
 * Two layers, deliberately:
 *
 *  1. Native CSS scroll-driven animations (`animation-timeline`) declared in
 *     base.css handle continuous, scroll-linked effects off the main thread.
 *  2. This module handles the things CSS timelines cannot express:
 *     one-shot entrance reveals, number counting, pointer tracking, the
 *     top scroll rail, and the horizontal-track overflow calculation.
 *
 * Everything degrades: with JavaScript unavailable the reveal elements are
 * hidden only by CSS that the observer immediately reverses, and every
 * effect here is cosmetic — no application state depends on it.
 */

import { useEffect, useRef, useState } from 'react'

/* ---------- Entrance reveals ---------------------------------- */

/** Adds `.is-in` to `[data-reveal]` elements as they enter the viewport. */
export function useRevealRoot() {
  useEffect(() => {
    const nodes = document.querySelectorAll('[data-reveal]:not(.is-in)')
    if (!nodes.length) return

    if (!('IntersectionObserver' in window)) {
      nodes.forEach((n) => n.classList.add('is-in'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    )

    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])
}

/* ---------- Count-up numbers ----------------------------------- */

/** Counts 0 -> value once the element scrolls into view. */
export function useCountUp(value, { decimals = 0, duration = 1600 } = {}) {
  const ref = useRef(null)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setDisplay(value)
      return
    }

    let frame = 0
    let started = false

    const run = () => {
      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration)
        // easeOutExpo — fast settle, no rubber-band at the end
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
        setDisplay(Number((value * eased).toFixed(decimals)))
        if (t < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !started) {
          started = true
          run()
          observer.disconnect()
        }
      },
      { threshold: 0.4 }
    )
    observer.observe(node)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [value, decimals, duration])

  return { ref, display }
}

/* ---------- Scroll progress rail ------------------------------- */

/** Drives the fixed top progress bar from document scroll. */
export function useScrollProgress() {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    let frame = 0
    const update = () => {
      frame = 0
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0
      node.style.transform = `scaleX(${ratio})`
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  return ref
}

/* ---------- Sticky masthead ------------------------------------ */

export function useSticky(breakpoint = 24) {
  const ref = useRef(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    let frame = 0
    const update = () => {
      frame = 0
      setStuck(window.scrollY > breakpoint)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [breakpoint])

  return { ref, stuck }
}

/* ---------- Pointer tracking ----------------------------------- */

/**
 * Tracks the pointer across the page and writes `--mx` / `--my` on the
 * elements listed in `selectors`, feeding the CSS card spotlight.
 * Written through CSSOM (setProperty), never as an inline style attribute,
 * so the strict `style-src 'self'` policy is never exercised.
 */
export function usePointerSpotlight(selectors = '.card, .spotlight-cell') {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let last = { x: 0, y: 0 }

    const apply = () => {
      frame = 0
      for (const el of document.querySelectorAll(selectors)) {
        const rect = el.getBoundingClientRect()
        if (rect.bottom < -200 || rect.top > window.innerHeight + 200) continue
        const x = ((last.x - rect.left) / rect.width) * 100
        const y = ((last.y - rect.top) / rect.height) * 100
        el.style.setProperty('--mx', `${x.toFixed(2)}%`)
        el.style.setProperty('--my', `${y.toFixed(2)}%`)
      }
    }

    const onMove = (event) => {
      last = { x: event.clientX, y: event.clientY }
      if (!frame) frame = requestAnimationFrame(apply)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [selectors])
}

/** Soft glow that follows the cursor across the whole page. */
export function useCursorGlow() {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    let frame = 0
    let x = window.innerWidth / 2
    let y = window.innerHeight / 2
    let cx = x
    let cy = y

    const tick = () => {
      cx += (x - cx) * 0.12
      cy += (y - cy) * 0.12
      node.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`
      frame = requestAnimationFrame(tick)
    }

    const onMove = (event) => {
      x = event.clientX
      y = event.clientY
      node.classList.add('is-on')
    }
    const onLeave = () => node.classList.remove('is-on')

    frame = requestAnimationFrame(tick)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(frame)
    }
  }, [])

  return ref
}

/* ---------- Horizontal pinned track --------------------------- */

/**
 * Publishes how far a `.pin-track` must travel to reveal its last panel.
 * The CSS `track-x` keyframe reads it via `--track-overflow`.
 */
export function useTrackOverflow(ref, viewportRef) {
  useEffect(() => {
    const track = ref.current
    const viewport = viewportRef?.current
    if (!track || !viewport) return

    const measure = () => {
      const overflow = Math.max(0, track.scrollWidth - viewport.clientWidth)
      track.style.setProperty('--track-overflow', `${overflow}px`)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    observer.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, viewportRef])
}

/* ---------- Magnetic buttons ---------------------------------- */

/** Pulls a button slightly toward the pointer. Desktop pointers only. */
export function useMagnetic(strength = 0.28) {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const onMove = (event) => {
      const rect = node.getBoundingClientRect()
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        node.style.setProperty('--mag-x', `${(dx * strength).toFixed(1)}px`)
        node.style.setProperty('--mag-y', `${(dy * strength).toFixed(1)}px`)
        node.style.translate = `${(dx * strength).toFixed(1)}px ${(dy * strength).toFixed(1)}px`
      })
    }
    const onLeave = () => {
      cancelAnimationFrame(frame)
      node.style.translate = '0px 0px'
    }

    node.addEventListener('pointermove', onMove)
    node.addEventListener('pointerleave', onLeave)
    return () => {
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerleave', onLeave)
      cancelAnimationFrame(frame)
    }
  }, [strength])

  return ref
}

/* ---------- Reveal observer scoped to a subtree ---------------- */

export function useReveal() {
  const ref = useRef(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const nodes = root.querySelectorAll('[data-reveal]:not(.is-in)')
    if (!nodes.length) return

    if (!('IntersectionObserver' in window)) {
      nodes.forEach((n) => n.classList.add('is-in'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 }
    )
    nodes.forEach((n) => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  return ref
}

/* ---------- Media query ---------------------------------------- */

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (event) => setMatches(event.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
