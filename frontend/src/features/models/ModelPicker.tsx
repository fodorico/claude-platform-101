import { useGetModelSettings } from '../../api/generated/api'
import { PROVIDER_LABELS, useModelChoice, type Provider } from './modelChoice'

/** Pick the provider and model; providers without an API key are shown but disabled. */
export function ModelPicker() {
  const settings = useGetModelSettings()
  const { choice, choose } = useModelChoice()

  if (!settings.data) return null
  return (
    <select
      aria-label="Model"
      className="select select-sm w-36 rounded-full sm:w-52"
      value={choice ? `${choice.provider}:${choice.model}` : ''}
      disabled={!choice}
      onChange={(event) => {
        const [provider, ...model] = event.target.value.split(':')
        choose({ provider: provider as Provider, model: model.join(':') })
      }}
    >
      {!choice && <option value="">No model configured</option>}
      {settings.data.providers.map((provider) => (
        <optgroup
          key={provider.name}
          label={`${PROVIDER_LABELS[provider.name] ?? provider.name}${
            provider.available ? '' : ' (no API key)'
          }`}
        >
          {provider.models.map((model) => (
            <option key={model} value={`${provider.name}:${model}`} disabled={!provider.available}>
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
