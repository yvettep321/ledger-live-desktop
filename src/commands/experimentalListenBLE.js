// @flow

import { createCommand } from 'helpers/ipc'
import { Observable } from 'rxjs'
import TransportNodeBle from 'hw-transport-node-ble'
import { map } from 'rxjs/operators'

const descriptorsById = {}

const cmd: any = createCommand('experimentalListenBLE', () =>
  Observable.create(TransportNodeBle.listen).pipe(
    map(obj => {
      const { descriptor } = obj
      console.log(descriptor)
      descriptorsById[descriptor.uuid] = descriptor
      return {
        id: descriptor.uuid,
        name: 'TOTO',
      }
    }),
  ),
)

export default cmd
