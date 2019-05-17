/* eslint-disable jsx-a11y/no-static-element-interactions */
// @flow

import React, { useCallback, useState, useRef } from 'react'
import Switch from 'components/base/Switch'
import experimentalListenBLE from 'commands/experimentalListenBLE'
import { scan } from 'rxjs/operators'
import { connect } from 'react-redux'
import { addDevice } from 'actions/devices'
import { getCurrentDevice } from 'reducers/devices'
import { createStructuredSelector } from 'reselect'

const ExperimentalSwitch = ({ name, currentDevice, addDevice }: *) => {
  const [checked, setChecked] = useState(false)
  const [devices, setDevices] = useState([])
  const subscription = useRef(null)

  const onUncheck = useCallback(
    () => {
      if (subscription.current) {
        subscription.current.unsubscribe()
        subscription.current = null
      }
      setChecked(false)
    },
    [name],
  )

  const onCheck = useCallback(
    () => {
      setChecked(true)
      subscription.current = experimentalListenBLE
        .send()
        .pipe(scan((acc, e) => acc.concat(e), []))
        .subscribe(setDevices)
    },
    [name],
  )

  const onChose = useCallback(d => {
    addDevice({ path: `ble:${d.id}`, modelId: 'nanoX' })
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <div>
        <Switch
          isChecked={checked}
          onChange={checked ? onUncheck : onCheck}
          data-e2e={`${name}_button`}
        />
      </div>
      <div style={{ padding: 20 }}>
        {devices.map(d => (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events
          <div
            style={{
              fontWeight:
                currentDevice && currentDevice.path && currentDevice.path.includes(d.id)
                  ? 800
                  : 300,
            }}
            key={d.id}
            onClick={() => onChose(d)}
          >
            {d.name}
          </div>
        ))}
      </div>
    </div>
  )
}

export default connect(
  createStructuredSelector({
    currentDevice: getCurrentDevice,
  }),
  { addDevice },
)(ExperimentalSwitch)
