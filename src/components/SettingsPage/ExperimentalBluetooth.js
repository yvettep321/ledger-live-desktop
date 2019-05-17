// @flow

import React, { useCallback, useState, useRef } from 'react'
import Switch from 'components/base/Switch'
import useEnv from 'hooks/useEnv'
import experimentalListenBLE from 'commands/experimentalListenBLE'
import { scan, tap } from 'rxjs/operators'

type Props = {
  name: string,
  readOnly: boolean,
  onChange: (name: string, val: mixed) => boolean,
}

const ExperimentalSwitch = ({ onChange, name }: Props) => {
  const value = useEnv(name)
  const [checked, setChecked] = useState(!!value)
  const [devices, setDevices] = useState([])
  const subscription = useRef(null)

  const onUncheck = useCallback(
    () => {
      if (subscription.current) {
        subscription.current.unsubscribe()
        subscription.current = null
      }
      setChecked(false)
      onChange(name, '')
    },
    [name],
  )

  const onCheck = useCallback(() => {
    setChecked(true)
    subscription.current = experimentalListenBLE
      .send()
      .pipe(scan((acc, e) => acc.concat(e), []))
      .subscribe(setDevices)
  }, [])

  return (
    <>
      <Switch
        isChecked={checked}
        onChange={checked ? onUncheck : onCheck}
        data-e2e={`${name}_button`}
      />
      <div>
        {devices.map(d => (
          <div onClick={() => onChange(name, d.id)}>
            {d.id} {d.name}
          </div>
        ))}
      </div>
    </>
  )
}

export default ExperimentalSwitch
