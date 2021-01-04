// @flow
import logger from 'logger'
import { throwError } from 'rxjs'
import { registerTransportModule } from '@ledgerhq/live-common/lib/hw'
import { addAccessHook, setErrorRemapping } from '@ledgerhq/live-common/lib/hw/deviceAccess'
import { setEnvUnsafe, getEnv } from '@ledgerhq/live-common/lib/env'
import throttle from 'lodash/throttle'
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid'
import TransportHttp from '@ledgerhq/hw-transport-http'
import { DisconnectedDevice } from '@ledgerhq/errors'
import { retry } from './promise'
import './implement-libcore'
import { openById } from '../commands/experimentalListenBLE'

/* eslint-disable guard-for-in */
for (const k in process.env) {
  setEnvUnsafe(k, process.env[k])
}
/* eslint-enable guard-for-in */

let busy = false

TransportNodeHid.setListenDevicesPollingSkip(() => busy)

const refreshBusyUIState = throttle(() => {
  if (process.env.CLI) return
  process.send({
    type: 'setDeviceBusy',
    busy,
  })
}, 100)

addAccessHook(() => {
  busy = true
  refreshBusyUIState()
  return () => {
    busy = false
    refreshBusyUIState()
  }
})

setErrorRemapping(e => {
  // NB ideally we should solve it in ledgerjs
  if (e && e.message && e.message.indexOf('HID') >= 0) {
    return throwError(new DisconnectedDevice(e.message))
  }
  return throwError(e)
})

registerTransportModule({
  id: 'ble',
  open: globalId => {
    if (!globalId.startsWith('ble:')) {
      return null
    }
    return openById(globalId.slice(4)).then(t => {
      t.setDebugMode(logger.apdu)
      return t
    })
  },
  disconnect: () => Promise.resolve(),
})

if (getEnv('DEVICE_PROXY_URL')) {
  const Tr = TransportHttp(getEnv('DEVICE_PROXY_URL').split('|'))

  registerTransportModule({
    id: 'proxy',
    open: () => retry(() => Tr.create(3000, 5000)),
    disconnect: () => Promise.resolve(),
  })
} else {
  registerTransportModule({
    id: 'hid',
    open: async devicePath => {
      const t = await retry(() => TransportNodeHid.open(devicePath), { maxRetry: 4 })
      t.setDebugMode(logger.apdu)
      return t
    },
    disconnect: () => Promise.resolve(),
  })
}
