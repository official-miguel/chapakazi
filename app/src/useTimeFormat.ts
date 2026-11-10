import { useMemo } from 'react'
import { useI18n } from './i18n'

/** Dates and times written the Kenyan way, in the app's current language. */
export function useTimeFormat() {
  const { lang } = useI18n()
  return useMemo(() => {
    const locale = lang === 'sw' ? 'sw-KE' : 'en-KE'
    const timeFmt = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
    const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' })
    return {
      time: (ms: number) => timeFmt.format(ms),
      day: (ms: number) => dayFmt.format(ms),
      dateTime: (ms: number) => `${dayFmt.format(ms)}, ${timeFmt.format(ms)}`,
    }
  }, [lang])
}
