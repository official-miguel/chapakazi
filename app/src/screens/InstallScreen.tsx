import { Download, Share, SquarePlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { canPromptInstall, isInstalled, isIos, onInstallChange, promptInstall } from '../install'

/** Public page (no login) the website links to: one big Download button that installs the app. */
export function InstallScreen() {
  const [, tick] = useState(0)
  const [done, setDone] = useState(false)
  useEffect(() => onInstallChange(() => tick((n) => n + 1)), [])

  const installed = done || isInstalled()
  const ios = isIos()
  const canPrompt = canPromptInstall()

  async function download() {
    if (await promptInstall()) setDone(true)
  }

  return (
    <div className="install">
      <img src="/logo.svg" alt="" width={96} height={96} className="install-logo" />
      <h1>Chapa Biz</h1>
      <p className="install-tag">Hustle smarter, not harder.</p>

      {installed ? (
        <>
          <p className="install-msg">Chapa Biz is installed on this phone.</p>
          <Link className="btn btn-primary install-btn" to="/">
            Open Chapa Biz
          </Link>
        </>
      ) : canPrompt ? (
        <>
          <button className="btn btn-primary install-btn" onClick={download}>
            <Download size={18} /> Download the app
          </button>
          <p className="install-fine">Free to install. It opens from your home screen and works with no internet.</p>
        </>
      ) : ios ? (
        <ol className="install-steps">
          <li>
            Tap <Share size={16} className="inline" /> <b>Share</b> at the bottom of Safari.
          </li>
          <li>
            Choose <SquarePlus size={16} className="inline" /> <b>Add to Home Screen</b>.
          </li>
          <li>
            Tap <b>Add</b>, then open Chapa Biz from your home screen.
          </li>
        </ol>
      ) : (
        <>
          <ol className="install-steps">
            <li>
              Open this page in <b>Chrome</b>.
            </li>
            <li>
              Tap the <b>⋮ menu</b> at the top right.
            </li>
            <li>
              Choose <b>Install app</b> or <b>Add to Home screen</b>.
            </li>
          </ol>
        </>
      )}

      {!installed && (
        <Link className="install-skip" to="/">
          Or use it in the browser for now
        </Link>
      )}
    </div>
  )
}
