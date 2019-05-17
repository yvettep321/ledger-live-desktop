// @flow
/* eslint-disable prefer-template */

import noble from 'noble-mac'
import Transport from '@ledgerhq/hw-transport'
import { DisconnectedDevice } from '@ledgerhq/errors'
import { getBluetoothServiceUuids, getInfosForServiceUuid } from '@ledgerhq/devices'
import type { DeviceModel } from '@ledgerhq/devices'
import { Observable, defer, merge, from } from 'rxjs'
import { share, ignoreElements, first, map, tap } from 'rxjs/operators'
import { logSubject } from './debug'
import type { Device, Characteristic } from './types'
import { sendAPDU } from './sendAPDU'
import { receiveAPDU } from './receiveAPDU'
import { monitorCharacteristic } from './monitorCharacteristic'

const POWERED_ON = 'poweredOn'

const availability: Observable<boolean> = Observable.create(observer => {
  const onAvailabilityChanged = e => {
    observer.next(e === POWERED_ON)
  }
  noble.addListener('stateChanged', onAvailabilityChanged) // events lib?
  observer.next(noble.state === POWERED_ON)
  return () => {
    noble.removeListener('stateChanged', onAvailabilityChanged)
  }
})

const transportsCache = {}

const disconnectDevice = device =>
  new Promise((resolve, reject) => {
    device.disconnect(error => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

const retrieveService = async device => {
  if (!device.gatt) throw new Error('bluetooth gatt not found')
  const [service] = await device.gatt.getPrimaryServices()
  if (!service) throw new Error('bluetooth service not found')
  const infos = getInfosForServiceUuid(service.uuid)
  if (!infos) throw new Error('bluetooth service infos not found')
  return [service, infos]
}

async function open(deviceOrId: Device | string, needsReconnect: boolean) {
  let device
  if (typeof deviceOrId === 'string') {
    if (transportsCache[deviceOrId]) {
      logSubject.next({
        type: 'verbose',
        message: 'Transport in cache, using that.',
      })
      return transportsCache[deviceOrId]
    }

    logSubject.next({
      type: 'verbose',
      message: 'Transport not in cache, need to relisten.',
    })

    throw new DisconnectedDevice()
  } else {
    device = deviceOrId
  }

  if (device.state === 'disconnected') {
    logSubject.next({
      type: 'verbose',
      message: 'not connected. connecting...',
    })

    const connect = () =>
      new Promise((resolve, reject) => {
        device.connect(error => {
          if (error) {
            reject(new Error(error))
          } else {
            resolve()
          }
        })
      })

    await connect()
  }

  const retrieveService = device =>
    new Promise((resolve, reject) => {
      device.discoverServices(null, (error, services) => {
        services[0].discoverCharacteristics(null, (
          // only one service for LNX
          error,
          characteristics,
        ) => {
          error
            ? reject(new Error(error))
            : // TODO should reuse logic of devices like done in other transports
              characteristics[0].properties[0] === 'notify'
              ? resolve([services[0], ...characteristics])
              : resolve([services[0], ...characteristics.reverse()])
        })
      })
    })

  const [service, notifyC, writeC] = await retrieveService(device)

  const notifyObservable = monitorCharacteristic(notifyC).pipe(
    tap(value => {
      logSubject.next({
        type: 'ble-frame-read',
        message: value.toString('hex'),
      })
    }),
    share(),
  )

  const notif = notifyObservable.subscribe()
  const deviceModel = null // FIXME

  const transport = new BluetoothTransport(device, writeC, notifyObservable, deviceModel)

  if (device.state === 'disconnected') {
    throw new DisconnectedDevice()
  }

  transportsCache[transport.id] = transport
  const onDisconnect = e => {
    delete transportsCache[transport.id]
    transport.notYetDisconnected = false
    notif.unsubscribe()
    device.removeListener('disconnect', onDisconnect)
    logSubject.next({
      type: 'verbose',
      message: `BleTransport(${transport.id}) disconnected`,
    })
    transport.emit('disconnect', e)
  }
  device.addListener('disconnect', onDisconnect) // will it catch their own "on" events? peripheral.once('disconnect', callback);

  let beforeMTUTime = Date.now()
  try {
    await transport.inferMTU()
  } finally {
    let afterMTUTime = Date.now()

    // workaround for #279: we need to open() again if we come the first time here,
    // to make sure we do a disconnect() after the first pairing time
    // because of a firmware bug

    if (afterMTUTime - beforeMTUTime < 1000) {
      needsReconnect = false // (optim) there is likely no new pairing done because mtu answer was fast.
    }

    if (needsReconnect) {
      await disconnectDevice(device)
      // necessary time for the bonding workaround
      await new Promise(s => setTimeout(s, 4000))
    }
  }

  if (needsReconnect) {
    return open(device, false)
  }

  return transport
}

/**
 * node bluetooth BLE implementation
 * @example
 * import BluetoothTransport from "@ledgerhq/hw-transport-node-ble";
 */
export default class BluetoothTransport extends Transport<Device | string> {
  static isSupported = (): Promise<boolean> => Promise.resolve(true)

  /**
   * observe event with { available: bool, type: string }
   * (available is generic, type is specific)
   * an event is emit once and then each time it changes
   */
  static observeAvailability = (observer: *) => availability.subscribe(observer)

  static list = (): * => Promise.resolve([])

  /**
   * Scan for Ledger Bluetooth devices.
   * On this implementation, it only emits ONE device, the one that was selected in the UI (if any).
   */
  static listen(o: *) {
    logSubject.next({
      type: 'verbose',
      message: 'listen...',
    })
    return Observable.create(observer => {
      const discoveredDevices = {}

      const allowDuplicates = true
      const detectingDevices = peripheral => {
        if (
          peripheral.advertisement.localName !== 'unknown' &&
          peripheral.advertisement.localName
        ) {
          if (!discoveredDevices[peripheral.uuid]) {
            discoveredDevices[peripheral.uuid] = peripheral
            observer.next({
              type: 'add',
              descriptor: peripheral,
              device: {
                id: peripheral.uuid,
                name: peripheral.advertisement.localName,
              },
            })
          }
        }
      }
      noble.addListener('discover', detectingDevices)

      noble.startScanning(getBluetoothServiceUuids(), allowDuplicates)

      function unsubscribe() {
        noble.removeListener('discover', detectingDevices)
        noble.stopScanning()
      }

      return unsubscribe
    }).subscribe(o)
  }

  /**
   * open a bluetooth device.
   */
  static async open(deviceOrId: Device | string) {
    return open(deviceOrId, true)
  }

  /**
   * globally disconnect a bluetooth device by its id.
   */
  static disconnect = async (id: *) => {
    logSubject.next({
      type: 'verbose',
      message: `user disconnect(${id})`,
    })
    const transport = transportsCache[id]
    if (transport) {
      await disconnectDevice(transport.device)
    }
  }

  id: string

  device: Device

  mtuSize: number = 20

  writeCharacteristic: Characteristic

  notifyObservable: Observable<Buffer>

  notYetDisconnected = true

  deviceModel: DeviceModel

  constructor(
    device: Device,
    writeCharacteristic: Characteristic,
    notifyObservable: Observable<*>,
    deviceModel: DeviceModel,
  ) {
    super()
    this.id = device.id
    this.device = device
    this.writeCharacteristic = writeCharacteristic
    this.notifyObservable = notifyObservable
    this.deviceModel = deviceModel

    logSubject.next({
      type: 'verbose',
      message: `BleTransport(${String(this.id)}) new instance`,
    })
  }

  async inferMTU() {
    let mtu = 23

    await this.exchangeAtomicImpl(async () => {
      try {
        mtu =
          (await merge(
            this.notifyObservable.pipe(
              first(buffer => buffer.readUInt8(0) === 0x08),
              map(buffer => buffer.readUInt8(5)),
            ),
            defer(() => from(this.write(Buffer.from([0x08, 0, 0, 0, 0])))).pipe(ignoreElements()),
          ).toPromise()) + 3
      } catch (e) {
        logSubject.next({
          type: 'ble-error',
          message: 'inferMTU got ' + String(e),
        })
        await disconnectDevice(this.device)
        throw e
      }
    })

    if (mtu > 23) {
      const mtuSize = mtu - 3
      logSubject.next({
        type: 'verbose',
        message: `BleTransport(${String(this.id)}) mtu set to ${String(mtuSize)}`,
      })
      this.mtuSize = mtuSize
    }

    return this.mtuSize
  }

  /**
   * Exchange with the device using APDU protocol.
   * @param apdu
   * @returns a promise of apdu response
   */
  exchange = (apdu: Buffer): Promise<Buffer> =>
    this.exchangeAtomicImpl(async () => {
      try {
        const { debug } = this

        const msgIn = apdu.toString('hex')
        if (debug) debug(`=> ${msgIn}`) // eslint-disable-line no-console
        logSubject.next({ type: 'ble-apdu-write', message: msgIn })

        const data = await merge(
          this.notifyObservable.pipe(receiveAPDU),
          sendAPDU(this.write, apdu, this.mtuSize),
        ).toPromise()

        const msgOut = data.toString('hex')
        logSubject.next({ type: 'ble-apdu-read', message: msgOut })
        if (debug) debug(`<= ${msgOut}`) // eslint-disable-line no-console

        return data
      } catch (e) {
        logSubject.next({
          type: 'ble-error',
          message: 'exchange got ' + String(e),
        })
        if (this.notYetDisconnected) {
          // in such case we will always disconnect because something is bad.
          disconnectDevice(this.device)
        }
        throw e
      }
    })

  setScrambleKey = () => {}

  write = async (buffer: Buffer) => {
    logSubject.next({
      type: 'ble-frame-write',
      message: buffer.toString('hex'),
    })
    await new Promise((resolve, reject) => {
      this.writeCharacteristic.write(buffer, false, e => {
        if (e) reject(e)
        else resolve()
      })
    })
  }

  async close() {
    if (this.exchangeBusyPromise) {
      // What is this?
      await this.exchangeBusyPromise
    }
  }
}
