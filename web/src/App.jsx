import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'

import { Ambient, ScrollRail, Masthead, Footer } from './components/Chrome.jsx'
import CookieConsent from './components/CookieConsent.jsx'
import { useRevealRoot } from './lib/motion.js'
import { PRIVATE_ROUTES } from './pages/care/routes.jsx'

import Home from './pages/Home.jsx'
import HowItWorks from './pages/HowItWorks.jsx'
import Service from './pages/Service.jsx'
import Care from './pages/Care.jsx'
import PatientInfo from './pages/PatientInfo.jsx'
import Clinicians from './pages/Clinicians.jsx'
import Blog from './pages/Blog.jsx'
import Pricing from './pages/Pricing.jsx'
import Faq from './pages/Faq.jsx'
import About from './pages/About.jsx'
import Contact from './pages/Contact.jsx'
import Legal from './pages/Legal.jsx'
import NotFound from './pages/NotFound.jsx'

import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'
import './styles/parity.css'
import './styles/care.css'
import './styles/parity-care.css'
import './styles/premium.css'
import './styles/resource.css'

/* The stylesheet recovered from the production build. Imported last so its
   definitions win any tie with the hand-written sheets above — the two agree
   on 686 of 722 shared rules, and the rest are the components this build is
   still missing. */
import './styles/recovered.css'

/** Restores scroll position on navigation, and honours in-page hashes. */
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const timer = window.setTimeout(() => {
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, 0)
      return () => window.clearTimeout(timer)
    }
    window.scrollTo(0, 0)
    return undefined
  }, [pathname, hash])
  return null
}

export default function App() {
  const { pathname } = useLocation()
  useRevealRoot(pathname)

  return (
    <>
      <ScrollManager />
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Ambient />
              <ScrollRail />
              <CookieConsent />
              <a className="skip-link" href="#main-content">
                Skip to content
              </a>
              <Masthead />
              <main id="main-content" tabIndex={-1}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/how-it-works" element={<HowItWorks />} />
                  <Route path="/service" element={<Service />} />
                  <Route path="/care" element={<Care />} />
                  <Route path="/patient-info" element={<PatientInfo />} />
                  <Route path="/clinicians" element={<Clinicians />} />
                  {/* Individual clinician profiles were removed from the public
                      site; these URLs redirect to the standards page. */}
                  <Route path="/clinicians/:slug" element={<Navigate to="/clinicians" replace />} />
                  <Route path="/blog" element={<Blog />} />
                  <Route path="/blog/:slug" element={<Blog />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/faq" element={<Faq />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/privacy-policy" element={<Legal kind="privacy" />} />
                  <Route path="/terms-conditions" element={<Legal kind="terms" />} />
                  <Route path="/refund-policy" element={<Legal kind="refund" />} />
                  <Route path="/telehealth-consent" element={<Legal kind="telehealth" />} />
                  <Route path="/medical-disclaimer" element={<Legal kind="medicalDisclaimer" />} />
                  <Route path="/accessibility" element={<Legal kind="accessibility" />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
              <Footer />
            </>
          }
        />

        {/* Care workspaces render without marketing chrome — they are
            noindex, permission-gated application surfaces, not pages. */}
        {PRIVATE_ROUTES.map(({ path, element: Element }) => (
          <Route key={path} path={path} element={<Element />} />
        ))}
      </Routes>
    </>
  )
}
