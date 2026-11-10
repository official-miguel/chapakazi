import { bizTypes } from '../bizTypes'
import type { BusinessType } from '../db'
import { useI18n } from '../i18n'

/** Name and type of a business. Used at sign-up and when an owner adds another shop. */
export function BusinessFields({
  name,
  type,
  onName,
  onType,
}: {
  name: string
  type: BusinessType
  onName: (name: string) => void
  onType: (type: BusinessType) => void
}) {
  const { t } = useI18n()
  return (
    <>
      <label className="field">
        <span>{t('biz.name')}</span>
        <input value={name} onChange={(e) => onName(e.target.value)} maxLength={60} autoComplete="organization" />
      </label>
      <div className="field">
        <span>{t('biz.type')}</span>
        <div className="chips">
          {bizTypes.map((b) => (
            <button
              key={b.type}
              type="button"
              className={b.type === type ? 'chip chip-on' : 'chip'}
              aria-pressed={b.type === type}
              onClick={() => onType(b.type)}
            >
              {t(b.label)}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
