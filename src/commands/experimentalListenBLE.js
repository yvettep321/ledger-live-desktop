// @flow

import { createCommand } from 'helpers/ipc'
import { Observable } from 'rxjs'
import TransportNodeBle from 'hw-transport-node-ble'
import { logsObservable } from 'hw-transport-node-ble/src/debug'
import logger from 'logger'
import { map, first } from 'rxjs/operators'

const descriptorsById = {}

export const openById = (id: string) => {
  const descriptor = descriptorsById[id]
  if (descriptor) {
    return TransportNodeBle.open(descriptor)
  }
  return Observable.create(TransportNodeBle.listen)
    .pipe(
      map(e => e.device.id),
      first(),
    )
    .toPromise()
    .then(TransportNodeBle.open)
}

logsObservable.subscribe(e => {
  logger.log(`${e.type}: ${e.message}`)
})

const cmd: any = createCommand('experimentalListenBLE', () =>
  Observable.create(TransportNodeBle.listen).pipe(
    map(obj => {
      const { device, descriptor } = obj
      descriptorsById[device.id] = descriptor
      return device
    }),
  ),
)

export default cmd
