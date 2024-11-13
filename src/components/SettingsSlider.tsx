import { Slider } from './Slider'
import type { SettingsUI, SettingsUISlider } from '@/types/provider'
import type { Accessor } from 'solid-js'

// 实现一个设置界面的滑块组件

interface Props {
  settings: SettingsUI
  editing: Accessor<boolean>
  value: Accessor<number>
  setValue: (v: number) => void
}

const SettingsNotDefined = () => {
  // 当设置未定义时显示“Not Defined”。
  return (
    <div class="op-25">Not Defined</div>
  )
}

export default ({ settings, editing, value, setValue }: Props) => {
  if (!settings.name || !settings.type) return null
  const sliderSettings = settings as SettingsUISlider

  return (
    <div>
      {editing() && (
        <Slider
          setValue={setValue}
          max={sliderSettings.max}
          value={value}
          min={sliderSettings.min}
          step={sliderSettings.step}
        />
      )}
      {!editing() && value() && (
        <div>{value()}</div>
      )}
      {!editing() && !value() && (
        <SettingsNotDefined />
      )}
    </div>
  )
}
