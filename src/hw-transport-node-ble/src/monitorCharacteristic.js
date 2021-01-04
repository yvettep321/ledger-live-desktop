// @flow
import { Observable } from 'rxjs'
import type { Characteristic } from './types'
import { logSubject } from './debug'

export const monitorCharacteristic = (characteristic: Characteristic): Observable<Buffer> =>
  Observable.create(o => {
    logSubject.next({
      type: 'verbose',
      message: 'start monitor ' + characteristic.uuid,
    })

    function onCharacteristicValueChanged(data) {
      console.log({ data })
      o.next(Buffer.from(data))
    }
    function onSubscribe(error) {
      if (error) o.error(error)
    }

    console.log(characteristic)

    characteristic.on('data', onCharacteristicValueChanged)
    characteristic.subscribe(onSubscribe)

    return () => {
      logSubject.next({
        type: 'verbose',
        message: 'end monitor ' + characteristic.uuid,
      })
      characteristic.removeListener('data', onCharacteristicValueChanged)
      characteristic.unsubscribe()
    }
  })
