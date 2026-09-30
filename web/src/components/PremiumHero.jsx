import { useEffect, useRef } from 'react'
import { IconVideo, IconCheck, IconShield } from './Icons.jsx'

export const RESOURCE_IMAGES = {
  'preparing-for-your-evaluation': '/assets/care-preparation.webp',
  'certification-is-not-a-state-card': '/assets/card-premium.webp',
  'what-changes-when-you-renew': '/assets/botanical-leaves.webp'
}

export function SampleCard({ eager = false }) {
  return <img className="medical-card" src="/assets/card-premium.webp" alt="Demo medical cannabis card for Avery Morgan, with sample portrait, patient ID, birth date, issue date, expiry date and state. Not a real credential." width="1000" height="630" loading={eager ? 'eager' : 'lazy'} decoding="async" />
}

export function TelehealthScene() {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    const media = window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)')
    let frame = 0
    const reset = () => {
      cancelAnimationFrame(frame)
      node.style.setProperty('--scene-x', '0deg')
      node.style.setProperty('--scene-y', '0deg')
    }
    const move = (event) => {
      if (!media.matches) return
      const box = node.getBoundingClientRect()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        node.style.setProperty('--scene-x', `${(event.clientY - box.top - box.height / 2) / box.height * -7}deg`)
        node.style.setProperty('--scene-y', `${(event.clientX - box.left - box.width / 2) / box.width * 9}deg`)
      })
    }
    node.addEventListener('pointermove', move)
    node.addEventListener('pointerleave', reset)
    media.addEventListener('change', reset)
    return () => {
      cancelAnimationFrame(frame)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerleave', reset)
      media.removeEventListener('change', reset)
    }
  }, [])

  return (
    <div className="telehealth-scene" ref={ref}>
      <div className="scene-orbit scene-orbit--outer" aria-hidden="true" />
      <div className="scene-orbit scene-orbit--inner" aria-hidden="true" />
      <span className="scene-caption">A little more human. A lot more clear.</span>
      <div className="scene-depth">
        <div className="botanical-disc">
          <img src="/assets/botanical-bud.webp" alt="Close-up of a medical cannabis flower" width="1000" height="667" decoding="async" />
          <span>Rooted in better care</span>
        </div>
        <figure className="doctor-window">
          <div className="doctor-window__top"><span className="status-dot" />Telehealth consultation<IconShield size={15} /></div>
          <img src="/assets/telehealth-doctor.webp" alt="Illustrative stock portrait of a doctor in a white coat" width="1000" height="667" fetchPriority="high" />
          <figcaption><span><strong>A real conversation.</strong><small>From wherever you feel comfortable.</small></span><span className="video-disc"><IconVideo size={22} /></span></figcaption>
          <span className="scene-stock">Illustrative photography</span>
        </figure>
        <div className="scene-card"><SampleCard eager /></div>
        <div className="scene-assurance"><span><IconCheck size={17} /></span><div><strong>Your next step, made clear.</strong><small>Clinician led. State specific.</small></div></div>
      </div>
    </div>
  )
}
