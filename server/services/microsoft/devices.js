import { graphGetAllPages } from './graphClient.js'
import { MICROSOFT_CAPABILITIES } from './capabilities.js'

const CTX = { capabilityLabel: MICROSOFT_CAPABILITIES.intune_devices.label, requiredPermissions: MICROSOFT_CAPABILITIES.intune_devices.permissions }

// Fields on the Graph `managedDevice` resource (Intune) — backs the "Intune
// Device Management" capability. Field availability can vary slightly by
// tenant/Intune configuration/device platform — anything a tenant omits
// simply comes back undefined and is stored as null, never fabricated.
// "ownership" in product terms = managedDeviceOwnerType (values: company,
// personal, unknown).
//
// NOTE: `approximateLastSignInDateTime` was tried and removed — live
// testing against a real tenant returned a 400 "Could not find a property
// named 'approximateLastSignInDateTime' on type 'microsoft.graph.
// managedDevice'" for Graph v1.0, i.e. it isn't a real v1.0 field (an
// invalid field in $select fails the ENTIRE request, not just that field).
// Not substituting a different property for it — simply not requested.
// https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice
const SELECT = [
  'id', 'deviceName', 'userId', 'userPrincipalName', 'operatingSystem', 'osVersion',
  'complianceState', 'managementState', 'managedDeviceOwnerType', 'managementAgent',
  'enrolledDateTime', 'lastSyncDateTime', 'deviceRegistrationState',
  'manufacturer', 'model', 'serialNumber', 'azureADDeviceId',
  'emailAddress', 'phoneNumber', 'wiFiMacAddress', 'ethernetMacAddress',
  'totalStorageSpaceInBytes', 'freeStorageSpaceInBytes'
].join(',')

export async function fetchManagedDevices(accessToken) {
  return graphGetAllPages(accessToken, `/deviceManagement/managedDevices?$select=${SELECT}&$top=999`, CTX)
}

// Reverse of applications.js's fetchDevicesForApp — "what's installed on
// THIS device" — used on-demand by the User/Device detail views. A user
// typically has only 1-3 devices, so this is cheap to call live rather than
// relying on the (sparsely populated — see applications.js) bulk-synced
// device_applications join table.
//
// DELIBERATE, ISOLATED v1.0 EXCEPTION: verified by direct testing against
// this project's live tenant that `managedDevice -> detectedApps` does NOT
// exist in Graph v1.0 at all — neither `/managedDevices/{id}/detectedApps`
// nor `?$expand=detectedApps` resolve (both return a 400 "Could not find a
// property/segment"). The identical relationship IS available in the beta
// endpoint (confirmed working, real data). Every other capability and
// endpoint in this integration uses v1.0; this is the one relationship
// with no v1.0 equivalent, so it uses beta rather than going unimplemented
// or falling back to the much more expensive tenant-wide reverse scan.
// Uses the SAME DeviceManagementManagedDevices.Read.All permission already
// granted — no new permission required.
const DETECTED_APP_SELECT = ['id', 'displayName', 'version', 'publisher', 'platform', 'sizeInByte'].join(',')
export async function fetchDetectedAppsForDevice(accessToken, deviceMsId) {
  return graphGetAllPages(accessToken, `https://graph.microsoft.com/beta/deviceManagement/managedDevices/${deviceMsId}/detectedApps?$select=${DETECTED_APP_SELECT}&$top=999`, CTX)
}
