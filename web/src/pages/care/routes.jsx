import PatientIntake from './PatientIntake.jsx'
import ClinicianPortal from './ClinicianPortal.jsx'
import StaffDesk from './StaffDesk.jsx'
import AdminConsole from './AdminConsole.jsx'

/**
 * Care workspaces.
 *
 * These render without marketing chrome. The service marks /patient, /portal,
 * /staff and /admin noindex and applies the strict private CSP plus a
 * permissions policy, so they must not inherit the public site's ambient
 * layers or global motion work.
 */
export const PRIVATE_ROUTES = [
  { path: '/patient', element: PatientIntake },
  { path: '/portal', element: ClinicianPortal },
  { path: '/staff', element: StaffDesk },
  { path: '/admin', element: AdminConsole }
]
