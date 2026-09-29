// Synthetic identities for isolated browser tests only. Never imported by src/.
export const browserActors = {
  patient: { id: '10000000-0000-4000-8000-000000000001', role: 'PATIENT', token: 'p'.repeat(43) },
  doctor: { id: '10000000-0000-4000-8000-000000000002', role: 'DOCTOR', token: 'd'.repeat(43) },
  staff: { id: '10000000-0000-4000-8000-000000000003', role: 'STAFF', token: 's'.repeat(43) },
  admin: { id: '10000000-0000-4000-8000-000000000004', role: 'ADMIN', token: 'a'.repeat(43) },
  recoveryPatient: {
    id: '10000000-0000-4000-8000-000000000005',
    role: 'PATIENT',
    token: 'r'.repeat(43)
  },
  deliveryPatient: {
    id: '10000000-0000-4000-8000-000000000006',
    role: 'PATIENT',
    token: 'b'.repeat(43)
  }
}
