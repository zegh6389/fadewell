import { useEffect, useRef } from 'react'
import { IconVideo, IconCheck, IconShield } from './Icons.jsx'

export const RESOURCE_IMAGES = {
  'preparing-for-your-evaluation': '/assets/blog/preparing-evaluation-cover.webp',
  'certification-is-not-a-state-card': '/assets/blog/certification-card-cover.webp',
  'what-changes-when-you-renew': '/assets/blog/renewal-changes-cover.webp'
}

export function SampleCard({ eager = false }) {
  return (
    <div className="medical-card-stage">
      <div className="medical-card medical-card--flip">
        <img
          className="medical-card__face"
          src="/assets/card-premium.webp"
          alt="Demo medical cannabis card for Avery Morgan, with sample portrait, patient ID, birth date, issue date, expiry date and state. Not a real credential."
          width="1000"
          height="630"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
        />
        <img
          className="medical-card__face medical-card__face--back"
          src="/assets/card-premium-back.svg"
          alt="MyFloraMD sample card back with cannabis safety notes, state requirements reminder, and decorative barcode. Demo only, not a valid credential."
          width="1000"
          height="630"
          decoding="async"
        />
      </div>
    </div>
  )
}

/**
 * The hero scene.
 *
 * Pure markup. This used to track the pointer and tilt the whole scene in 3D
 * via `--scene-x` / `--scene-y`; neither the variables nor a `card-arrive`
 * animation exist anywhere in the production bundle, so both were additions of
 * mine rather than things the original build lost. The composition is layered
 * with `translateZ` in CSS instead, which is how the production scene gets its
 * depth.
 */
export function TelehealthScene() {
  return (
    <div className="telehealth-scene">
      <div className="scene-orbit scene-orbit--outer" aria-hidden="true" />
      <div className="scene-orbit scene-orbit--inner" aria-hidden="true" />
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
