import { articles } from './resourceCentre.js'
/**
 * MmjGreen — site content.
 *
 * Single source of truth for copy used across the public site.
 * Kept separate from components so copy edits never touch layout code.
 */

export const brand = {
  name: 'MmjGreen',
  tagline: 'Medical card evaluation, made calm.',
  email: 'care@mmjgreen.com',
  phone: '888-809-3204',
  phoneHref: '+18888093204',
  address: '1200 Market Street, Suite 400, Denver, CO 80202',
  hours: 'Mon–Fri, 8am–8pm MT · Sat, 9am–3pm MT'
}

/* ---------- Navigation -------------------------------------- */

export const primaryNav = [
  { label: 'How it works', to: '/how-it-works' },
  { label: 'What we treat', to: '/care' },
  { label: 'Clinicians', to: '/clinicians' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Blog', to: '/blog' },
  { label: 'About', to: '/about' }
]

export const footerNav = [
  {
    title: 'Care',
    links: [
      { label: 'How it works', to: '/how-it-works' },
      { label: 'What we treat', to: '/care' },
      { label: 'Clinicians', to: '/clinicians' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'State fees and access', to: '/#state-reference' }
    ]
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Blog', to: '/blog' },
      {
        label: 'Pennsylvania guide',
        to: '/blog/pennsylvania-medical-cannabis-card-caregiver-rules'
      },
      { label: 'FAQ', to: '/faq' }
    ]
  },
  {
    title: 'Get care',
    links: [
      { label: 'Start your intake', to: '/patient' },
      { label: 'Clinician sign in', to: '/portal' },
      { label: 'Care operations', to: '/staff' },
      { label: 'Administration', to: '/admin' }
    ]
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy policy', to: '/privacy-policy' },
      { label: 'Terms of service', to: '/terms-conditions' },
      { label: 'Refund policy', to: '/refund-policy' },
      { label: 'Telehealth consent', to: '/telehealth-consent' },
      { label: 'Medical disclaimer', to: '/medical-disclaimer' },
      { label: 'Accessibility', to: '/accessibility' }
    ]
  }
]

/* ---------- Hero -------------------------------------------- */

export const hero = {
  pill: 'Accepting new patients in 14 states',
  lede:
    'A short online intake, a real clinician, and a clear path to your medical card. No waiting rooms, no guesswork — just the next step, made obvious.',
  primaryCta: { label: 'Start your intake', to: '/patient' },
  secondaryCta: { label: 'See how it works', to: '/how-it-works' },
  notes: ['2 minute questionnaire', 'Licensed clinicians', '10–15 minute evaluation process']
}

/* ---------- Journey ----------------------------------------- */

export const journey = [
  {
    step: '01',
    icon: 'map',
    title: 'Sign up and choose your state',
    body:
      'Enter your contact details and choose your state. We check service availability and send you a secure patient link, so there is no password to remember.',
    detail: 'A secure link keeps your care in one place'
  },
  {
    step: '02',
    icon: 'clipboard',
    title: 'Complete a short questionnaire',
    body:
      'Tell us about your medical history, current medications, allergies, and what brings you in. The questionnaire takes about 2 minutes.',
    detail: 'About 2 minutes'
  },
  {
    step: '03',
    icon: 'video',
    title: 'Talk with a doctor',
    body:
      'A licensed clinician reviews your answers and calls you for the evaluation. Signup, questionnaire, and the doctor conversation typically take 10–15 minutes in total, or up to 30 minutes if you want an in-depth discussion. Where your state requires an in-person visit or other steps, those requirements still apply. State registration and card issuance are separate.',
    detail: '10–15 minutes total; up to 30 minutes for an in-depth conversation'
  },
  {
    step: '04',
    icon: 'card',
    title: 'Apply for a plastic card or use a digital version',
    body:
      'If certified, follow your state’s registration requirements. Apply for a physical (plastic) card where available, or use a state-approved digital card or certification where accepted. State fees, processing times, and available formats vary.',
    detail: 'Card formats and state requirements vary by location'
  },
  {
    step: '05',
    icon: 'map',
    title: 'Know your state’s next step',
    body:
      'Before your first purchase, check accepted documents and state fees. California allows adult medicinal purchases with a valid physician recommendation, subject to verification. Pennsylvania requires an active state card and a $50 annual state payment unless waived. Compare all states below.',
    detail: 'Evaluation fees and state program fees are separate',
    reference: { to: '/#state-reference', label: 'All-state fees and access guide' }
  }
]

/* ---------- Story / process detail --------------------------- */

export const storySteps = [
  {
    num: '01',
    title: 'Built around your state, not a generic template',
    body:
      'Most online card services hand you the same questionnaire everywhere. MmjGreen reads your jurisdiction first, so the questions you answer and the options you are offered actually apply where you live.'
  },
  {
    num: '02',
    title: 'A real clinician, on a real schedule',
    body:
      'Every evaluation is performed by a licensed practitioner in your state. Your treating clinician introduces themselves during your private care interaction; public doctor profiles are not displayed.'
  },
  {
    num: '03',
    title: 'Nothing disappears after checkout',
    body:
      'Your intake, appointment, clinician notes and application status live in one place. If something needs your attention, we tell you — you never have to wonder what happened next.'
  },
  {
    num: '04',
    title: 'Consent you can actually read',
    body:
      'We ask for contact permission separately from care consent, in plain language, and you can change your mind at any time. We never sell patient information.'
  }
]

/* ---------- Trust markers ----------------------------------- */

export const trustMarks = [
  { icon: 'shield', label: 'HIPAA-aligned handling' },
  { icon: 'badge', label: 'State-licensed clinicians' },
  { icon: 'clock', label: '10–15 minute evaluation process' },
  { icon: 'lock', label: '256-bit encrypted records' },
  { icon: 'chat', label: 'No patient data sold' }
]

/* ---------- Stats ------------------------------------------- */

export const stats = [
  { value: 12400, suffix: '+', label: 'Evaluations completed' },
  { value: 14, suffix: '', label: 'States served' },
  { value: 4.9, suffix: '/5', label: 'Average patient rating', decimals: 1 },
  { value: 15, suffix: ' min', label: 'Typical evaluation process: 10–15 minutes' }
]

/* ---------- Conditions -------------------------------------- */

export const conditions = [
  {
    title: 'Chronic pain',
    body: 'Persistent pain that limits movement, sleep or daily activity — including joint, back and neuropathic pain.',
    tag: 'Most common'
  },
  {
    title: 'Anxiety & PTSD',
    body: 'Generalised anxiety, panic disorder and post-traumatic stress, including symptoms related to qualifying trauma.',
    tag: 'Common'
  },
  {
    title: 'Insomnia',
    body: 'Difficulty falling or staying asleep three or more nights a week, with daytime effects that interfere with normal activity.',
    tag: 'Common'
  },
  {
    title: 'Depression',
    body: 'Major depressive disorder and treatment-resistant depression, diagnosed by a licensed clinician.',
    tag: 'Common'
  },
  {
    title: 'Appetite & weight',
    body: 'Documented loss of appetite or clinically significant weight change where cannabis may support nutrition.',
    tag: 'Supported'
  },
  {
    title: 'Nausea & chemotherapy',
    body: 'Nausea and vomiting associated with cancer treatment or other qualifying medical conditions.',
    tag: 'Supported'
  },
  {
    title: 'Epilepsy & seizures',
    body: 'Seizure disorders, including qualifying conditions where a clinician has documented benefit from cannabis.',
    tag: 'Specialist'
  },
  {
    title: 'Glaucoma & neuropathy',
    body: 'Intractable glaucoma and diabetic or chemotherapy-induced peripheral neuropathy in supported jurisdictions.',
    tag: 'Specialist'
  }
]

/* ---------- Clinical standards ------------------------------- */

/**
 * What a patient can expect from the evaluation.
 *
 * Replaces the former clinician directory. The production build stopped
 * publishing clinician names, portraits, biographies and licences, and says so
 * on this page and on the home page — so there is deliberately no roster here
 * to drift out of step with that claim.
 */
export const evaluationStandards = [
  {
    title: 'Licensed for your state',
    body: 'Your evaluation is handled by a clinician licensed where you receive care. State requirements determine the permitted evaluation format.'
  },
  {
    title: 'An independent decision',
    body: 'A clinician reviews your questionnaire and speaks with you before making a decision. Neither MmjGreen nor the care chatbot can promise approval.'
  },
  {
    title: 'A private clinical conversation',
    body: 'Discuss your history and questions in your secure care interaction. We do not publish clinician names, portraits, biographies, or personal profiles on this website.'
  },
  {
    title: 'Time for your questions',
    body: 'The signup, 2 minute questionnaire, and doctor conversation typically take 10–15 minutes in total. Allow up to 30 minutes for an in-depth conversation. State registry processing is separate.'
  }
]

/* ---------- Pricing ----------------------------------------- */

export const plans = [
  {
    name: 'Consultation',
    price: '79',
    cadence: 'one-time',
    description: 'Everything you need for a complete evaluation and your state application.',
    featured: true,
    badge: 'Most chosen',
    cta: { label: 'Start your intake', to: '/patient' },
    features: [
      'Licensed clinician evaluation, video or phone',
      'Full intake and medical history review',
      'State application prepared and submitted',
      'Application tracked until your card is issued',
      'Unlimited secure messaging for 12 months',
      'Free re-evaluation if your first application is denied'
    ]
  },
  {
    name: 'Follow-up',
    price: '39',
    cadence: 'per visit',
    description: 'For renewals, dose conversations and clinician follow-up once you are a patient.',
    featured: false,
    badge: null,
    cta: { label: 'Book a follow-up', to: '/patient' },
    features: [
      'Clinician follow-up consultation',
      'Dose and product guidance discussion',
      'Renewal paperwork prepared and submitted',
      'Secure messaging between visits',
      'Time to discuss your questions'
    ]
  },
  {
    name: 'Caregiver card',
    price: '79',
    cadence: 'one-time',
    description: 'For the parent, spouse or legal guardian helping someone through their evaluation.',
    featured: false,
    badge: null,
    cta: { label: 'Start an intake', to: '/patient' },
    features: [
      'Caregiver identity verification',
      'Linked patient record and consent flow',
      'Licensed clinician evaluation',
      'Separate caregiver card application',
      'Renewal reminders for both cards'
    ]
  }
]

export const pricingNotes = [
  'No subscription. No membership. You pay once per evaluation.',
  'State application fees are collected directly by your state registry and are not included above.',
  'If your application is denied, we re-evaluate at no cost within 90 days.'
]

/* ---------- Testimonials ------------------------------------ */

export const testimonials = [
  {
    quote:
      'I had put this off for two years. The questionnaire was honest and short, and I saw exactly what would happen next at every stage. My card arrived eleven days after the evaluation.',
    name: 'Maya R.',
    location: 'Denver, CO',
    rating: 5
  },
  {
    quote:
      'The part that mattered most was that it told me my state had different rules instead of pretending they were the same everywhere. That saved me from a wasted appointment.',
    name: 'Devon T.',
    location: 'Portland, OR',
    rating: 5
  },
  {
    quote:
      'I was nervous about the video call and the tech just worked. Booking, reminders, joining — all of it. I have recommended MmjGreen to two friends since.',
    name: 'Jordan K.',
    location: 'Reno, NV',
    rating: 5
  }
]

/* ---------- FAQ -------------------------------------------- */

export const faqs = [
  {
    q: 'What actually happens in the evaluation?',
    a: 'A licensed clinician reviews your intake and questionnaire, then joins you for a short live consultation — by video or phone, your choice. They will ask follow-up questions, confirm your history and, if your situation qualifies, complete the medical provider portion of your state application. You can ask questions throughout, and nothing is submitted without your confirmation.'
  },
  {
    q: 'Do I need to create an account?',
    a: 'Sign up with your contact details and state, then complete the questionnaire. You do not need to create a password. Your secure patient link lets you return to your care record.'
  },
  {
    q: 'How long does the whole process take?',
    a: 'Sign up, complete the questionnaire in about 2 minutes, then speak with a doctor. The evaluation process typically takes 10–15 minutes in total, or up to 30 minutes if you want an in-depth conversation. Any required in-person assessment, state registration, and card issuance are separate and follow your state’s rules.'
  },
  {
    q: 'What if I live somewhere you do not serve?',
    a: 'MmjGreen currently operates in 14 states. Enter your state during intake and we will tell you honestly whether we can help. If we cannot, we will say so plainly and point you to the state’s own physician registry rather than sending you through a process that will not work.'
  },
  {
    q: 'Is my information sold or shared?',
    a: 'No. Patient information is never sold. We share only what a state registry requires to process your application, and we ask for separate, specific permission before sending you any marketing or non-essential messages. You can withdraw contact permission at any time without affecting your care.'
  },
  {
    q: 'What if my first application is denied?',
    a: 'We re-evaluate at no cost within 90 days. In practice most denials come down to a documentation gap or a state rule we can address together, and your care team will explain exactly what the registry flagged.'
  },
  {
    q: 'Can I speak to a clinician without a video call?',
    a: 'Yes. Choose phone instead of video during intake if you prefer. Both are full evaluations and produce the same provider documentation. If you select video and lose connection, the call converts to audio rather than ending.'
  },
  {
    q: 'What do I need to have ready for the consultation?',
    a: 'A valid photo ID, the email or phone number on your application, and any medical records you already have that feel relevant. You do not need to have a diagnosis letter — that is part of what the evaluation is for.'
  }
]

/* ---------- Why MmjGreen ----------------------------------- */

export const pillars = [
  {
    icon: 'map',
    title: 'Jurisdiction-aware from the first question',
    body:
      'We check your state before you answer anything, so you never fill out a form that will not apply to you.'
  },
  {
    icon: 'badge',
    title: 'Credentialed where you live',
    body:
      'Each clinician is licensed in the states they evaluate in. We explain our clinical standards without displaying individual doctor profiles.'
  },
  {
    icon: 'clock',
    title: 'Scheduling that respects your week',
    body:
      'Evening and Saturday availability, rescheduling without penalty, and reminders that actually arrive.'
  },
  {
    icon: 'lock',
    title: 'Consent that means something',
    body:
      'Contact consent is separate from care consent, plain-language, and revocable at any time.'
  }
]

/* ---------- Workspaces (role gateways) --------------------- */

export const careAreas = [
  {
    key: 'patient',
    label: 'Patient',
    title: 'Your care.\nOne calm place.',
    body:
      'Complete your intake, follow your appointment and prepare for your conversation with a clinician — without creating a password.',
    points: [
      ['No account needed', 'Finish your form and questionnaire in one secure session.'],
      ['Always know the next step', 'See review status, appointment details and application progress in one view.'],
      ['Come back easily', 'Your secure link keeps your record reachable without a password.']
    ]
  },
  {
    key: 'portal',
    label: 'Clinician',
    title: 'Your day.\nRoom for care.',
    body:
      'A focused workspace for your schedule, assigned evaluations, availability, and the consultation controls you need.',
    points: [
      ['A clear view of your day', 'Appointments and assigned patients, ordered by what is next.'],
      ['Time on your terms', 'Publish availability and adjust consultation duration as you go.'],
      ['Context before the conversation', 'Review exactly what the patient shared before you join.']
    ]
  },
  {
    key: 'staff',
    label: 'Care operations',
    title: 'Less searching.\nMore helping.',
    body:
      'Move from intake review to scheduling with clear queues, contact history, and a record of every action taken.',
    points: [
      ['Work from a real queue', 'Find submissions needing review or corrected information.'],
      ['Keep the handoff intact', 'Record contact attempts and administrative review notes.'],
      ['Schedule with confidence', 'Book against clinician availability and appointment buffers.']
    ]
  },
  {
    key: 'admin',
    label: 'Administration',
    title: 'A considered view.\nAccountable control.',
    body:
      'Review access, operational activity and delivery readiness from a dedicated administrative workspace.',
    points: [
      ['Purposeful access', 'Review accounts and revoke access when responsibilities change.'],
      ['Traceable activity', 'Inspect record access and operational changes.'],
      ['See what needs attention', 'Review queued events and service configuration gaps.']
    ]
  }
]

/* ---------- Legal copy ------------------------------------- */

export const legalDocs = {
  privacy: {
    title: 'Privacy policy',
    updated: 'September 2026',
    intro:
      'This policy explains what personal information MmjGreen collects, why we collect it, and the choices you have. It is written to be read, not to be skipped.',
    sections: [
      {
        h: 'Information we collect',
        p: [
          'We collect information you give us directly: your name, email address, phone number, date of birth, state of residence, and the answers you provide in our intake questionnaire. This includes your goals, medical history, current medications, allergies and any identification document you upload for verification.',
          'We also record technical information needed to operate the service securely: your device and browser type, approximate location derived from your IP address, and the time and nature of actions you take in your account. We use this for security, fraud prevention and to understand where the service is difficult to use.'
        ]
      },
      {
        h: 'How we use your information',
        p: [
          'We use your information to complete your medical card evaluation, prepare and submit your application to the relevant state registry, schedule and conduct your consultation, deliver notifications you have consented to receive, and provide support.',
          'We do not sell personal information. We do not share your medical history for advertising. We share information with a state registry only where that registry requires it to process your application, and with our clinicians only so they can perform your evaluation.'
        ]
      },
      {
        h: 'Consent and permissions',
        p: [
          'We ask for consent to treat and consent to contact as separate, specific permissions. Giving one does not imply the other. You can withdraw your contact permission at any time from your secure link, and you can withdraw care consent at any time before your application is submitted.',
          'Where we rely on consent for processing your health information, you may withdraw it at any time. Withdrawing consent does not affect care already provided or information already used lawfully before withdrawal.'
        ]
      },
      {
        h: 'How we protect it',
        p: [
          'Health information is encrypted in transit and at rest. Access to your record is limited to the clinicians assigned to your evaluation and to the operations staff required to coordinate your care. Every access to a patient record is logged and auditable.',
          'No system is perfectly secure. If a breach affects your information we will notify you and the relevant regulator without undue delay and describe what happened plainly.'
        ]
      },
      {
        h: 'Cookies and browser preferences',
        p: [
          'Essential cookies support secure sessions and core features. We store your cookie preference locally on your device for 180 days, without putting medical answers or identification documents in that preference. You can change your choice using Cookie settings in the website footer.',
          'No optional analytics or advertising plugin is currently installed. Choosing to allow optional cookies records your preference; it does not give permission to use health information for advertising. Cookie permission is separate from medical consent and notification preferences. If your browser blocks preference storage, your choice applies to the current visit and you may be asked again after reloading.'
        ]
      },
      {
        h: 'How long we keep it',
        p: [
          'We keep clinical records for the period required by the laws of the state where you were evaluated, which is commonly seven years. Marketing preferences are kept until you withdraw them. Technical security logs are kept for up to 24 months.'
        ]
      },
      {
        h: 'Your rights',
        p: [
          'You can request a copy of your information, ask us to correct it, ask us to delete it where we are not required to keep it, or ask us to send it to another provider. To make any of these requests, contact us and we will respond within 30 days.',
          'You have the right to complain to your state medical board or to the relevant health privacy authority. We would rather you told us first, but you are not required to.'
        ]
      }
    ]
  },
  terms: {
    title: 'Terms of service',
    updated: 'September 2026',
    intro:
      'These terms describe the agreement between you and MmjGreen when you use our site, complete an intake, or receive care through our clinicians.',
    sections: [
      {
        h: 'Using this service',
        p: [
          'Medical patient and caregiver age requirements vary by state. Minors require the applicable parent, guardian, or caregiver pathway. You agree to provide accurate information and keep your secure link confidential.',
          'You may not use MmjGreen to obtain a card through misrepresentation, to impersonate another person, or in a way that interferes with another person’s care or with the operation of the service.'
        ]
      },
      {
        h: 'Clinical services',
        p: [
          'Evaluations are performed by independently licensed clinicians, not by MmjGreen. MmjGreen provides the technology, coordination and administrative support around that clinical relationship.',
          'Your clinician may decline to complete an evaluation, and we may decline to continue service, where they believe an evaluation is not appropriate or where the law of your state does not permit it. Where we decline before a consultation, we refund the evaluation fee.'
        ]
      },
      {
        h: 'Fees and payment',
        p: [
          'Consultation fees are shown before you book and are charged when your evaluation is confirmed. State application fees are set by and paid to your state registry and are not part of our fee.',
          'If we cannot complete your evaluation, or your first application is denied through no fault of yours, we re-evaluate at no cost within 90 days. Other refund situations are covered in our refund policy.'
        ]
      },
      {
        h: 'Your responsibilities',
        p: [
          'Answer the intake honestly and completely, attend your scheduled consultation, and tell your clinician about anything that could affect your safety or treatment. Tell us promptly if your contact details change so we can reach you.',
          'Do not use MmjGreen for emergencies. If you are in crisis, call 911 or 988.'
        ]
      },
      {
        h: 'Liability',
        p: [
          'MmjGreen provides clinical evaluations and administrative services but does not provide emergency care and cannot guarantee that a state registry will approve an application. Decisions about whether to issue a card are made by your state, not by us.',
          'To the extent permitted by law, our aggregate liability for claims arising from use of the service is limited to the amount you paid us in the twelve months before the claim arose. Nothing in these terms limits liability that cannot lawfully be limited.'
        ]
      },
      {
        h: 'Changes',
        p: [
          'We may update these terms. If a change materially affects you, we will tell you through your secure link or by email before it takes effect. Continuing to use the service after that notice means you accept the updated terms.'
        ]
      }
    ]
  },
  refund: {
    title: 'Refund policy',
    updated: 'September 2026',
    intro:
      'We want the decision to be right for you. This policy explains when a fee is returned and how quickly.',
    sections: [
      {
        h: 'Full refunds',
        p: [
          'We issue a full refund of your evaluation fee if you cancel more than 24 hours before your scheduled consultation, if your clinician declines to evaluate you, if we cannot serve your state, or if there is a technical failure on our side that prevents your consultation from happening.'
        ]
      },
      {
        h: 'No-cost re-evaluation',
        p: [
          'If your state registry denies your application, we will review the denial with you and re-evaluate at no cost within 90 days. You are not charged twice for the same evaluation.'
        ]
      },
      {
        h: 'Late cancellation and no-show',
        p: [
          'Cancellations inside 24 hours and missed appointments are not refunded, because the clinician’s slot cannot be reused. We understand that things happen — message your care team as early as you can and we will look for a workable time.'
        ]
      },
      {
        h: 'State application fees',
        p: [
          'Fees charged by your state registry are outside our control and are non-refundable through MmjGreen. We will always show you what a state charges before you submit.'
        ]
      },
      {
        h: 'How refunds work',
        p: [
          'Refunds are returned to your original payment method. Depending on your bank, it can take 5–10 business days to appear. We process refund requests within two business days of receiving them.'
        ]
      }
    ]
  },
  telehealth: {
    title: 'Telehealth consent',
    updated: 'September 2026',
    intro:
      'Before your MmjGreen consultation begins, we need your informed consent to being evaluated remotely. Please read this fully — you will be asked to confirm it.',
    sections: [
      {
        h: 'What telehealth means here',
        p: [
          'Your evaluation is conducted over a secure video or voice connection rather than in person. Your clinician is licensed in the state where you are located and will verify your location at the start of the visit.'
        ]
      },
      {
        h: 'Benefits and limitations',
        p: [
          'Telehealth removes travel and waiting time and often gets you seen sooner. It also means your clinician cannot perform the hands-on examination that some conditions require, and cannot order physical tests during the visit. If your situation needs in-person assessment, your clinician will tell you and help you find appropriate care.'
        ]
      },
      {
        h: 'Privacy of your setting',
        p: [
          'Choose a private space. Others in your home can hear the consultation unless you use headphones. We cannot prevent someone else from entering the room during a video visit, and you are responsible for your own privacy.'
        ]
      },
      {
        h: 'Technology and emergencies',
        p: [
          'We test your connection and confirm audio and video before the clinical portion of your visit begins. If the connection drops, your clinician will call you by phone to continue. If you have a medical emergency during a session, leave the call and dial 911 first.'
        ]
      },
      {
        h: 'Recording',
        p: [
          'Your consultation is not recorded. Clinical notes are written by your clinician and stored securely as part of your medical record, exactly as they would be for an in-person visit.'
        ]
      },
      {
        h: 'Withdrawing consent',
        p: [
          'You may withdraw telehealth consent at any time, including mid-visit. Doing so ends the remote evaluation; we will not submit an application based on a visit you have chosen to stop.'
        ]
      }
    ]
  },
  medicalDisclaimer: {
    title: 'Medical disclaimer',
    updated: 'September 2026',
    intro:
      'Please read this carefully. It describes what MmjGreen is and is not, and the limits of the information you will find here.',
    sections: [
      {
        h: 'Not medical advice',
        p: [
          'Information on this site is provided for general education about the medical card process. It is not medical advice and it does not create a doctor–patient relationship. Only a licensed clinician who has evaluated you can advise you on your health.'
        ]
      },
      {
        h: 'No guarantee of approval',
        p: [
          'A card is issued by your state, not by MmjGreen. Your clinician evaluates whether you meet the medical criteria in your state; the state registry then makes its own decision. We cannot and do not guarantee that any application will be approved.'
        ]
      },
      {
        h: 'Cannabis and medication interactions',
        p: [
          'Cannabis can interact with prescription medicines, including blood thinners, sedatives and some psychiatric medications. Always tell your clinician and your pharmacist what you use, and never stop a prescribed medication because of something you read here.'
        ]
      },
      {
        h: 'Not for emergencies or crisis',
        p: [
          'MmjGreen is not an emergency service and does not provide crisis care. If you are in danger, thinking about harming yourself, or need immediate help, call or text 988, or dial 911.'
        ]
      },
      {
        h: 'Individual results vary',
        p: [
          'Eligibility, qualifying conditions and product restrictions differ by state and change over time. The information here reflects our understanding at the time of publication and is not a substitute for the current text of your state’s law.'
        ]
      }
    ]
  }
}

export const accessibility = {
  title: 'Accessibility statement',
  updated: 'September 2026',
  intro:
    'MmjGreen wants everyone to be able to use this site and reach our care team, regardless of technology or ability.',
  sections: [
    {
      h: 'Our commitment',
      p: [
        'We build and test this site against WCAG 2.2 Level AA. We aim for full keyboard operability, visible focus indicators, sufficient colour contrast, text that scales with your system settings, and respect for reduced-motion preferences.'
      ]
    },
    {
      h: 'Known limitations',
      p: [
        'Some third-party video consultation components are outside our control and may not yet meet every standard. Where that is the case we will offer a telephone alternative, which is a complete evaluation in every state we serve.'
      ]
    },
    {
      h: 'Need help, or found a barrier?',
      p: [
        'Email care@mmjgreen.com or call 888-809-3204. If something on this site is difficult to use, tell us what happened and which page you were on so we can help.'
      ]
    }
  ]
}

/* ---------- Contact ----------------------------------------- */

export const contactReasons = [
  'I have a question before starting an intake',
  'I need to reschedule or cancel an appointment',
  'I need help with my state application',
  'Something about my record needs correcting',
  'Media, partnership or licensing enquiry',
  'Something else'
]

/* ---------- About ------------------------------------------- */

export const values = [
  {
    title: 'Tell people the truth early',
    body:
      'If we cannot serve your state, we say so before you spend time on an intake. A short honest answer beats a long disappointing one.'
  },
  {
    title: 'Make the next step obvious',
    body:
      'Care is confusing enough. Every screen should tell you where you are, what happens next, and what you need to do about it.'
  },
  {
    title: 'Earn the trust we ask for',
    body:
      'We ask for sensitive health information. That obliges us to be conservative with it, explicit about consent, and accountable for every access.'
  },
  {
    title: 'Keep the clinician in the room',
    body:
      'Software should make a clinical conversation better, not stand in for one. Our clinicians make every decision that matters.'
  }
]

export const timeline = [
  { year: '2022', title: 'Founded in Denver', body: 'Two clinicians and an operations lead, building intake software for their own practice after watching patients struggle with paper forms.' },
  { year: '2023', title: 'First state programmes', body: 'Colorado, Washington and Oregon go live. Jurisdiction-aware intake becomes the core of the product rather than an afterthought.' },
  { year: '2024', title: 'Ten states', body: 'Care operations, clinician and admin workspaces ship as one system, with a full audit trail from first contact to card issuance.' },
  { year: '2025', title: 'Twelve thousand evaluations', body: 'The workflow focuses on a short questionnaire and a direct clinician conversation, with state registration tracked separately.' },
  { year: '2026', title: 'Fourteen states', body: 'Rebuilt around a single care record so a patient never has to repeat their history between steps, clinicians or states.' }
]

/* ---------- Parity with the MedCardAccess information architecture --- */

/**
 * Support details shown by the help launcher, the question form and the
 * contact page. Kept in one place so the three can never disagree.
 */
export const support = {
  phone: '888-809-3204',
  tel: 'tel:+18888093204',
  email: 'care@mmjgreen.com',
  mailto: 'mailto:care@mmjgreen.com'
}

/** States we have not opened yet. Everything else reads as available. */
export const comingSoon = ['Pennsylvania', 'Oklahoma']

/** The 50 states plus DC and the inhabited territories. */
export const stateNames = [
  'Alabama', 'Alaska', 'American Samoa', 'Arizona', 'Arkansas', 'California',
  'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Guam',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Northern Mariana Islands', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Puerto Rico', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'US Virgin Islands', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'Washington DC', 'West Virginia',
  'Wisconsin', 'Wyoming'
]

export function getStateOutcome(name) {
  if (!name) return { kind: 'error', message: 'Choose your state or territory to continue.' }
  if (comingSoon.includes(name)) {
    return { kind: 'coming-soon', message: `${name} is coming soon. We can add you to the launch list.` }
  }
  return {
    kind: 'available',
    message: `We can show you the next step for ${name}. Eligibility is still decided by a clinician, not this website.`
  }
}

/** Proof row directly under the hero. */
export const proofRibbon = [
  { icon: 'clock', title: 'Online evaluation, 24/7', note: 'Start when it suits you, not when a clinic opens.' },
  { icon: 'shield', title: 'Licensed clinician review', note: 'Every decision made independently, never automated.' },
  { icon: 'card', title: 'Refunded if not approved', note: 'The evaluation fee only. State fees are separate.' }
]

/** What to have ready before the consultation. */
export const preparationItems = [
  { icon: 'id', title: 'Photo identification', note: 'A current government-issued photo ID, so we can verify you at the visit.' },
  { icon: 'map', title: 'Proof of residency', note: 'Some state programmes require evidence that you live there.' },
  { icon: 'note', title: 'Your medical history', note: 'Current medications, conditions and anything a clinician should know.' },
  { icon: 'clock', title: 'Your current card', note: 'Renewing patients should have the existing certification to hand.' }
]

/** What happens after a clinician certifies you — a step people are often surprised by. */
export const afterAppointment = [
  'Follow the registration instructions your state gives you after the visit.',
  'Pay any government programme fee separately unless a state offer clearly includes it.',
  'Track your application in the state portal until the card is actually issued.'
]

/** The two entry paths, split so a first-timer and a renewal are not mixed up. */
export const patientPaths = [
  {
    key: 'new',
    eyebrow: 'First-time patient',
    title: 'Starting a new application?',
    body: 'Sign up with your state and contact details, have your identification ready, and complete the questionnaire in about 2 minutes before the doctor call.',
    action: 'Start a new application',
    to: '/patient'
  },
  {
    key: 'renew',
    eyebrow: 'Returning patient',
    title: 'Need to renew?',
    body: 'Renewal windows and registration steps change from year to year. Keep your current card nearby and check today’s requirements rather than assuming last year’s process still holds.',
    action: 'Check renewal availability',
    to: '/patient'
  }
]

/** Caregivers and under-18s follow different rules in most states. */
export const caregiver = {
  eyebrow: 'Caregivers and younger patients',
  title: 'Some patients need a caregiver pathway.',
  body: 'Rules for caregivers, patients under 18, background checks, registration and purchasing access vary by jurisdiction more than almost anything else in this process. Choose your state before relying on general guidance — the answer genuinely differs.',
  action: 'Read the patient guide',
  to: '/patient-info'
}

/** Two lines set word by word as they scroll into view. */
export const tagline = [
  'A clearer path to the evaluation you are considering.',
  'Guided, secure, and built around your state.'
]

/** Compliance panel — deliberately three concrete points, not a badge wall. */
export const compliance = {
  eyebrow: 'Compliance and security',
  title: 'Your health information deserves serious protection.',
  body: 'MmjGreen runs a HIPAA-aligned workflow built to protect patient information across the whole evaluation, not just the parts that are convenient to secure.',
  points: [
    { icon: 'lock', title: 'Encrypted in transit', note: 'Patient information is protected as it moves through the online workflow.' },
    { icon: 'shield', title: 'Collected narrowly', note: 'We only gather what the evaluation actually needs, and stop there.' },
    { icon: 'check', title: 'Clinician decides', note: 'Eligibility is a clinical judgement, never an automated outcome.' }
  ]
}

/**
 * Learning centre cards on the home page.
 *
 * These are the same records the resource centre indexes. They used to be a
 * second copy held here, and the copy quietly fell behind: it was missing the
 * cover `imageAlt` values, so the home page shipped four cards with empty alt
 * text while the blog had the right descriptions. Deriving the list from the
 * resource centre means the two screens cannot drift apart again.
 */
export const learningResources = articles

/**
 * Interior page: the process explained in full.
 *
 * The same five steps as `journey`, minus the timing detail line — this page
 * sets them out as one readable column for someone who arrived from search and
 * wants the whole sequence at once, rather than a horizontal gesture. Derived
 * rather than copied so the two pages cannot drift apart.
 */
export const serviceStages = journey.map(({ step, title, body, reference }) => ({
  num: step,
  title,
  body,
  reference
}))

export const servicePromises = [
  { icon: 'clock', title: 'A short questionnaire, then a call', note: 'About 2 minutes for the questionnaire and typically 10–15 minutes for the whole evaluation. Allow up to 30 minutes for an in-depth discussion; state-required in-person visits and registration are separate.' },
  { icon: 'shield', title: 'Independent clinical decision', note: 'No clinician is steered by a quota, a ranking or an upsell.' },
  { icon: 'card', title: 'Fees shown before you pay', note: 'Evaluation and state fees are itemised separately, every time.' },
  { icon: 'map', title: 'Jurisdiction-aware from step one', note: 'Requirements are checked against live data, not a cached page.' }
]

/** Interior page: the patient guide. */
export const guideSections = [
  {
    title: 'Before you start',
    body: [
      'You do not need to have decided anything. Choosing your state tells you what the process looks like where you live, and that is genuinely different from state to state.',
      'You will need a current government-issued photo ID. If your state requires proof of residency, have that ready too.',
      'Have a list of your current medications to hand. A clear list of what you take and why is more useful to a clinician than a folder of letters.'
    ]
  },
  {
    title: 'What your clinician will ask',
    body: [
      'Expect a conversation, not an interrogation. The clinician reviews your intake first, then asks about the things that intake could not answer on its own.',
      'They will want to understand your history, your current treatment, and what you are hoping to get out of this. Bring a list of medications and any relevant records.',
      'The decision is theirs alone. Nothing in our system recommends an outcome, and no clinician sees a target or a quota attached to your file.'
    ]
  },
  {
    title: 'How the consultation works',
    body: [
      'You choose video or phone when you book. Either way you get a confirmation with everything needed to join, including a reminder of what to have ready.',
      'Signup, the 2 minute questionnaire, and the doctor call typically take 10–15 minutes in total. Allow up to 30 minutes if you want an in-depth discussion. State-required in-person assessment and registration are separate.',
      'Everything stays in the same secure record, so you never have to repeat your history between steps, clinicians or states.'
    ]
  },
  {
    title: 'After a clinician certifies you',
    body: [
      'Certification is not a state card. Your state programme runs its own registration, with its own forms, its own fee and often its own waiting period.',
      'MmjGreen submits to your state registry and tracks the application from there. You will see every stage, and you always know whether something is waiting on you or on us.',
      'State fees are separate from ours unless a state-specific offer clearly says otherwise. We itemise them rather than folding them into a single number.'
    ]
  }
]

export const guideChecklist = [
  'Current government-issued photo ID',
  'Proof of residency, if your state requires it',
  'A list of your current medications',
  'Any relevant medical records you already have',
  'Your existing card, if you are renewing',
  'A quiet 10–15 minutes, or up to 30 minutes for an in-depth conversation, and a working camera or phone'
]
