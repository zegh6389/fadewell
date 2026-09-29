/**
 * FadeWell — motion engine.
 *
 * Two layers, deliberately:
 *
 *  1. Native CSS scroll-driven animations (`animation-timeline`) declared in
 *     base.css handle continuous, scroll-linked effects off the main thread.
 *  2. This module handles the things CSS timelines cannot express:
 *     one-shot entrance reveals, number counting, pointer tracking on the
 *     magnetic buttons, the top scroll rail, and horizontal-track overflow.
 *
 * Everything degrades: with JavaScript unavailable the reveal elements are
 * hidden only by CSS that the observer immediately reverses, and every
 * effect here is cosmetic — no application state depends on it.
 */

import { useEffect, useRef, useState } from 'react'

/* ---------- Entrance reveals ---------------------------------- */

/**
 * Shared reveal wiring.
 *
 * The IntersectionObserver deliberately uses a negative bottom margin so
 * elements reveal slightly after they enter rather than snapping the instant
 * a single pixel appears. That margin has a sharp edge case: content inside
 * the excluded band can never intersect. The last block of the page — the
 * footer note — always sits there, and the page cannot be scrolled further,
 * so it would stay at `opacity: 0` forever. A tail sweep releases anything
 * still pending once the reader approaches the end of the document.
 */
function wireReveal(root = document) {
  const pending = () => root.querySelectorAll('[data-reveal]:not(.is-in)')
  if (!pending().length) return () => {}

  const revealAll = () => {
    for (const n of pending()) n.classList.add('is-in')
    window.removeEventListener('scroll', onTail)
    window.removeEventListener('resize', onTail)
  }

  if (!('IntersectionObserver' in window)) {
    revealAll()
    return () => {}
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

  for (const n of pending()) observer.observe(n)

  const onTail = () => {
    const doc = document.documentElement
    if (window.scrollY + window.innerHeight >= doc.scrollHeight - window.innerHeight * 1.5) {
      revealAll()
    }
  }

  window.addEventListener('scroll', onTail, { passive: true })
  window.addEventListener('resize', onTail, { passive: true })

  return () => {
    observer.disconnect()
    window.removeEventListener('scroll', onTail)
    window.removeEventListener('resize', onTail)
  }
}

/** Adds `.is-in` to `[data-reveal]` elements as they enter the viewport. */
export function useRevealRoot() {
  useEffect(() => wireReveal(document), [])
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

/* ---------- Horizontal pinned track --------------------------- */

/**
 * Everything the pinned horizontal track needs, measured off the live layout
 * rather than derived in CSS. Three published values:
 *
 * - `--track-overflow`   how far the track must travel for the last panel to
 *                        land on the content column. The `track-x` keyframe
 *                        reads it.
 * - `--journey-gutter`   the content gutter. The track's viewport is
 *                        full-bleed, so the track has to supply the gutter
 *                        itself; it is read off the real column (the nearest
 *                        `.shell`) rather than recomputed from the tokens, so
 *                        the panels cannot drift out of line with the heading
 *                        above them.
 * - `--journey-range-*`  the scroll offsets at which the sticky pin engages
 *                        and releases. A `view()` timeline will not do: its
 *                        cover/contain ranges do not map onto the pin's stuck
 *                        window, so the track would already be part-way across
 *                        when the pin engaged. These go on the section, so the
 *                        track and the progress rule inherit one range and
 *                        cannot disagree.
 */
export function useTrackOverflow(ref, viewportRef) {
  useEffect(() => {
    const track = ref.current
    const viewport = viewportRef?.current
    if (!track || !viewport) return

    const section = viewport.closest('.journey')
    const pin = viewport.closest('.journey__pin')

    const measure = () => {
      const column = pin?.querySelector('.shell')
      if (column) {
        // The shell's border box is not the content column — its own
        // `padding-inline` is the gutter that actually aligns the text.
        const cs = getComputedStyle(column)
        const inset = column.getBoundingClientRect().left
          + parseFloat(cs.paddingLeft)
          - viewport.getBoundingClientRect().left
        track.style.setProperty('--journey-gutter', `${Math.max(0, Math.round(inset))}px`)
      }

      const overflow = Math.max(0, track.scrollWidth - viewport.clientWidth)
      track.style.setProperty('--track-overflow', `${overflow}px`)

      // The pin is stuck from the moment the section's top reaches the top of
      // the viewport until the section's bottom reaches the bottom of it.
      if (section && pin) {
        const top = section.getBoundingClientRect().top + window.scrollY
        const end = top + section.offsetHeight - pin.offsetHeight
        section.style.setProperty('--journey-range-start', `${Math.round(top)}px`)
        section.style.setProperty('--journey-range-end', `${Math.round(end)}px`)
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    observer.observe(viewport)
    // The section is `400vh` and the pin is `100svh`, so both endpoints of
    // the range move whenever the viewport does — not just on `resize`.
    if (section) observer.observe(section)
    if (pin) observer.observe(pin)
    // `--journey-range-*` is an absolute scroll offset, so it goes stale
    // whenever anything ABOVE the section changes height: a late image, a
    // webfont swapping in, a reveal that expands a panel. None of those resize
    // the section itself, so observing the section alone missed every one of
    // them, and the track would begin translating before the pin had engaged —
    // measured at 54px early once the home page grew above it. Observing the
    // document catches height changes anywhere above.
    observer.observe(document.documentElement)
    window.addEventListener('resize', measure)
    // Text metrics change after first paint, and images can resolve after the
    // effect has run. Both reflow the page above the pin.
    window.addEventListener('load', measure)
    document.fonts?.ready.then(measure, () => {})
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('load', measure)
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
    if (!root) return undefined
    return wireReveal(root)
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
