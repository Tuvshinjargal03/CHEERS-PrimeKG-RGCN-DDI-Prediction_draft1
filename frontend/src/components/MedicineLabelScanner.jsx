import { Camera, FileImage, LoaderCircle, ScanText, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { postJson } from '../lib/api.js'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MATCH_LIMIT = 10

const MATCH_LABELS = {
  exact_name_in_text: 'Exact label match',
  exact_drugbank_id: 'Exact DrugBank ID match',
  possible_text_match: 'Possible text match',
}

export default function MedicineLabelScanner({ targetLabel, onDrugSelect, disabled = false }) {
  const titleId = useId()
  const fileInputId = useId()
  const triggerRef = useRef(null)
  const closeRef = useRef(null)
  const dialogRef = useRef(null)
  const fileInputRef = useRef(null)
  const workerRef = useRef(null)
  const ocrJobId = useRef(0)
  const matchRequestId = useRef(0)
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [detectedText, setDetectedText] = useState('')
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)

  const busy = status === 'ocr' || status === 'matching'

  useEffect(() => () => {
    ocrJobId.current += 1
    matchRequestId.current += 1
    if (workerRef.current) {
      void workerRef.current.terminate().catch(() => {})
      workerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const cancelWork = useCallback(() => {
    ocrJobId.current += 1
    matchRequestId.current += 1
    const worker = workerRef.current
    workerRef.current = null
    if (worker) void worker.terminate().catch(() => {})
  }, [])

  const resetScanner = useCallback(() => {
    cancelWork()
    setPreviewUrl('')
    setFileName('')
    setDetectedText('')
    setMatches([])
    setStatus('idle')
    setMessage('')
    setOcrProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [cancelWork])

  const closeScanner = useCallback(() => {
    resetScanner()
    setOpen(false)
    window.setTimeout(() => triggerRef.current?.focus(), 0)
  }, [resetScanner])

  useEffect(() => {
    if (!open) return undefined
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0)
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeScanner()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeScanner, open])

  async function matchText(text) {
    const trimmed = text.trim()
    if (!trimmed) {
      setMatches([])
      setStatus('noText')
      setMessage('No readable medicine text was detected.')
      return
    }

    const currentRequest = matchRequestId.current + 1
    matchRequestId.current = currentRequest
    setStatus('matching')
    setMessage('Looking for supported drugs…')

    try {
      const data = await postJson('/api/drugs/match-text', {
        text: trimmed,
        limit: MATCH_LIMIT,
      })
      if (matchRequestId.current !== currentRequest) return
      const nextMatches = data.matches || []
      setMatches(nextMatches)
      if (nextMatches.length) {
        setStatus('matches')
        setMessage('Possible supported drugs found')
      } else {
        setStatus('noMatches')
        setMessage('No supported drug was found in the detected text.')
      }
    } catch {
      if (matchRequestId.current !== currentRequest) return
      setMatches([])
      setStatus('matchError')
      setMessage('Drug matching is unavailable. Please try again.')
    }
  }

  async function readImage(file) {
    cancelWork()
    const currentJob = ocrJobId.current + 1
    ocrJobId.current = currentJob
    setDetectedText('')
    setMatches([])
    setStatus('ocr')
    setMessage('Reading medicine label…')
    setOcrProgress(0)

    let worker = null
    try {
      const { createWorker } = await import('tesseract.js')
      if (ocrJobId.current !== currentJob) return
      worker = await createWorker('eng', undefined, {
        logger: (event) => {
          if (ocrJobId.current !== currentJob) return
          if (event.status === 'recognizing text' && Number.isFinite(event.progress)) {
            setOcrProgress(Math.round(event.progress * 100))
          }
        },
      })
      if (ocrJobId.current !== currentJob) return
      workerRef.current = worker
      const result = await worker.recognize(file)
      if (ocrJobId.current !== currentJob) return
      const text = String(result.data?.text || '').trim()
      setDetectedText(text)
      if (!text) {
        setStatus('noText')
        setMessage('No readable medicine text was detected.')
        return
      }
      await matchText(text)
    } catch {
      if (ocrJobId.current !== currentJob) return
      setDetectedText('')
      setMatches([])
      setStatus('ocrError')
      setMessage("We couldn't read this image. Try a clearer photo.")
    } finally {
      if (workerRef.current === worker) workerRef.current = null
      if (worker) await worker.terminate().catch(() => {})
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      resetScanner()
      setStatus('validationError')
      setMessage('Choose an image file such as a photo of the medicine package or label.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      resetScanner()
      setStatus('validationError')
      setMessage('This image is larger than 10 MB. Choose a smaller photo and try again.')
      return
    }

    setPreviewUrl(URL.createObjectURL(file))
    setFileName(file.name || 'Camera photo')
    void readImage(file)
  }

  function chooseMatch(match) {
    onDrugSelect({
      name: match.name,
      entity_id: match.entity_id,
      node_id: match.node_id,
    })
    closeScanner()
  }

  const modal = open ? (
    <div
      className="medicine-scanner-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeScanner()
      }}
    >
      <section
        ref={dialogRef}
        className="medicine-scanner-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="scanner-header">
          <div>
            <span className="eyebrow">Printed-label text helper</span>
            <h2 id={titleId}>Scan medicine label for {targetLabel}</h2>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={closeScanner} aria-label="Close medicine label scanner">
            <X size={18} />
          </button>
        </header>

        <div className="scanner-boundary">
          <ScanText size={21} aria-hidden="true" />
          <p>
            <strong>CHEERS reads printed medicine names from the image.</strong>
            It does not identify medicines from pill shape, color, or appearance.
          </p>
        </div>

        <p className="scanner-privacy">
          Only photograph the medicine/package label. Avoid including your name,
          prescription number, address, or other personal information. The image
          is processed in your browser for text recognition and is not uploaded
          or stored by CHEERS.
        </p>

        <div className="scanner-file-row">
          <input
            ref={fileInputRef}
            id={fileInputId}
            className="scanner-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFile}
          />
          <label className="scanner-file-button" htmlFor={fileInputId}>
            {previewUrl ? <FileImage size={17} /> : <Camera size={17} />}
            {previewUrl ? 'Replace photo' : 'Take or upload photo'}
          </label>
          {previewUrl && (
            <button type="button" className="scanner-remove-button" onClick={resetScanner}>
              <Trash2 size={16} />Remove photo
            </button>
          )}
        </div>

        {!previewUrl && status === 'idle' && (
          <div className="scanner-initial-state">
            <Camera size={30} aria-hidden="true" />
            <p>Take or upload a photo of the printed medicine label.</p>
            <small>JPEG, PNG, WebP, or another browser-supported image up to 10 MB.</small>
          </div>
        )}

        {previewUrl && (
          <figure className="scanner-preview">
            <img src={previewUrl} alt="Preview of the selected printed medicine label" />
            <figcaption>{fileName}</figcaption>
          </figure>
        )}

        {message && (
          <div className={`scanner-status ${status.endsWith('Error') || status === 'validationError' ? 'error' : ''}`} aria-live="polite">
            {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
            <div>
              <strong>{message}</strong>
              {status === 'ocr' && <span>{ocrProgress ? `${ocrProgress}% complete` : 'Preparing text recognition…'}</span>}
              {status === 'noMatches' && (
                <span>Try a clearer photo of the medicine label or enter the drug manually.</span>
              )}
            </div>
          </div>
        )}

        {detectedText && (
          <details className="scanner-detected-text">
            <summary>Detected text</summary>
            <p>OCR output may contain errors. Review it before selecting a supported drug.</p>
            <label>
              <span>Text read from the image</span>
              <textarea
                value={detectedText}
                rows="5"
                disabled={busy}
                onChange={(event) => {
                  setDetectedText(event.target.value)
                  setMatches([])
                  setStatus('review')
                  setMessage('Review the detected text, then look for supported drugs again.')
                }}
              />
            </label>
            <button type="button" className="secondary-button" disabled={busy || !detectedText.trim()} onClick={() => void matchText(detectedText)}>
              <ScanText size={16} />Match reviewed text
            </button>
          </details>
        )}

        {matches.length > 0 && (
          <div className="scanner-matches">
            <h3>Possible supported drugs found</h3>
            <p>Select one candidate to fill {targetLabel}. Selection does not run a prediction or load graph context.</p>
            <div role="group" aria-label={`Possible supported drugs for ${targetLabel}`}>
              {matches.map((match) => (
                <button
                  type="button"
                  className="scanner-match"
                  key={`${match.entity_id}-${match.node_id}`}
                  onClick={() => chooseMatch(match)}
                  aria-label={`Select ${match.name}, ${match.entity_id}, ${MATCH_LABELS[match.match_type] || 'Possible text match'}`}
                >
                  <span><strong>{match.name}</strong><small>{match.entity_id}</small></span>
                  <em>{MATCH_LABELS[match.match_type] || 'Possible text match'}</em>
                </button>
              ))}
            </div>
          </div>
        )}

        <footer className="scanner-footer">
          <p>CHEERS is a research prototype. This scanner only helps select a supported drug and does not provide clinical identification, diagnosis, medication advice, safety assessment, or interaction severity.</p>
          <button type="button" className="secondary-button" onClick={closeScanner}>Close</button>
        </footer>
      </section>
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="scanner-launch-button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <Camera size={15} />Scan medicine label
      </button>
      {modal && createPortal(modal, document.body)}
    </>
  )
}
