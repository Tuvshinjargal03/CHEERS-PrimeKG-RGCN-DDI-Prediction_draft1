import { Camera, FileImage, LoaderCircle, RotateCcw, ScanText, Trash2, X } from 'lucide-react'
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
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const workerRef = useRef(null)
  const ocrJobId = useRef(0)
  const matchRequestId = useRef(0)
  const cameraRequestId = useRef(0)
  const [open, setOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [detectedText, setDetectedText] = useState('')
  const [matches, setMatches] = useState([])
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [cameraMode, setCameraMode] = useState('idle')
  const [capturedFile, setCapturedFile] = useState(null)

  const busy = status === 'ocr' || status === 'matching' || cameraMode === 'starting' || cameraMode === 'capturing'

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

  const stopCamera = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    if (stream) stream.getTracks().forEach((track) => track.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => () => {
    cameraRequestId.current += 1
    stopCamera()
    ocrJobId.current += 1
    matchRequestId.current += 1
    if (workerRef.current) {
      void workerRef.current.terminate().catch(() => {})
      workerRef.current = null
    }
  }, [stopCamera])

  const resetScanner = useCallback(() => {
    cameraRequestId.current += 1
    stopCamera()
    cancelWork()
    setPreviewUrl('')
    setFileName('')
    setDetectedText('')
    setMatches([])
    setStatus('idle')
    setMessage('')
    setOcrProgress(0)
    setCameraMode('idle')
    setCapturedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [cancelWork, stopCamera])

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

  function clearImageResults() {
    setPreviewUrl('')
    setFileName('')
    setDetectedText('')
    setMatches([])
    setOcrProgress(0)
    setCapturedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function cameraErrorMessage(error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      return 'Camera permission was not granted. You can allow camera access or upload a photo instead.'
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'No camera was found on this device. You can upload a photo instead.'
    }
    if (
      error?.name === 'NotReadableError'
      || error?.name === 'TrackStartError'
      || error?.name === 'AbortError'
    ) {
      return 'The camera could not start. It may be in use by another application. Close other camera apps or upload a photo instead.'
    }
    return 'The camera is unavailable in this browser. Upload a photo instead.'
  }

  async function startCamera() {
    cancelWork()
    cameraRequestId.current += 1
    const currentRequest = cameraRequestId.current
    stopCamera()
    clearImageResults()
    setCameraMode('starting')
    setStatus('cameraStarting')
    setMessage('Starting camera...')

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMode('idle')
      setStatus('cameraError')
      setMessage('Camera access is not available in this browser. You can upload a photo instead.')
      return
    }

    let stream = null
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch (error) {
        if (error?.name !== 'OverconstrainedError') throw error
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }

      if (cameraRequestId.current !== currentRequest) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream
      setCameraMode('live')
      setStatus('idle')
      setMessage('')
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      const video = videoRef.current
      if (!video) throw new Error('Camera preview is unavailable')
      video.srcObject = stream
      await video.play()
    } catch (error) {
      if (stream && streamRef.current !== stream) {
        stream.getTracks().forEach((track) => track.stop())
      }
      if (cameraRequestId.current !== currentRequest) return
      stopCamera()
      setCameraMode('idle')
      setStatus('cameraError')
      setMessage(cameraErrorMessage(error))
    }
  }

  function cancelCamera() {
    cameraRequestId.current += 1
    stopCamera()
    clearImageResults()
    setCameraMode('idle')
    setStatus('idle')
    setMessage('')
  }

  function capturePhoto() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      cameraRequestId.current += 1
      stopCamera()
      setCameraMode('idle')
      setStatus('cameraError')
      setMessage('The camera image was not ready. Try opening the camera again, or upload a photo instead.')
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      cameraRequestId.current += 1
      stopCamera()
      setCameraMode('idle')
      setStatus('cameraError')
      setMessage('The photo could not be captured in this browser. Upload a photo instead.')
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    cameraRequestId.current += 1
    const currentCapture = cameraRequestId.current
    stopCamera()
    setCameraMode('capturing')
    setStatus('cameraStarting')
    setMessage('Preparing captured photo...')
    canvas.toBlob((blob) => {
      if (cameraRequestId.current !== currentCapture) return
      if (!blob) {
        setCameraMode('idle')
        setStatus('cameraError')
        setMessage('The photo could not be captured in this browser. Upload a photo instead.')
        return
      }
      const file = new File([blob], `medicine-label-${Date.now()}.jpg`, { type: 'image/jpeg' })
      setCapturedFile(file)
      setPreviewUrl(URL.createObjectURL(file))
      setFileName('Camera photo')
      setCameraMode('captured')
      setStatus('idle')
      setMessage('')
    }, 'image/jpeg', 0.92)
  }

  function useCapturedPhoto() {
    if (!capturedFile) return
    const file = capturedFile
    setCapturedFile(null)
    setCameraMode('idle')
    void readImage(file)
  }

  function prepareUpload() {
    if (cameraMode === 'starting' || cameraMode === 'live' || cameraMode === 'capturing') {
      cameraRequestId.current += 1
      stopCamera()
      clearImageResults()
      setCameraMode('idle')
      setStatus('idle')
      setMessage('')
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    cameraRequestId.current += 1
    stopCamera()
    setCameraMode('idle')
    setCapturedFile(null)

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
          prescription number, address, or other personal information. The camera
          is used only to capture the medicine label. Captured images are processed
          in your browser and are not uploaded or stored by CHEERS.
        </p>

        <div className="scanner-file-row">
          <button
            type="button"
            className="scanner-camera-button"
            disabled={cameraMode === 'starting' || cameraMode === 'capturing'}
            onClick={() => void startCamera()}
          >
            <Camera size={17} />Use camera
          </button>
          <input
            ref={fileInputRef}
            id={fileInputId}
            className="scanner-file-input"
            type="file"
            accept="image/*"
            onClick={prepareUpload}
            onChange={handleFile}
          />
          <label className="scanner-file-button" htmlFor={fileInputId}>
            <FileImage size={17} />
            {previewUrl ? 'Replace photo' : 'Upload photo'}
          </label>
          {previewUrl && cameraMode !== 'captured' && (
            <button type="button" className="scanner-remove-button" onClick={resetScanner}>
              <Trash2 size={16} />Remove photo
            </button>
          )}
        </div>

        <canvas ref={canvasRef} className="scanner-capture-canvas" aria-hidden="true" />

        {(cameraMode === 'starting' || cameraMode === 'live') && (
          <div className="scanner-camera-stage">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="Live camera preview of the medicine label"
            />
            <p>Position the printed medicine name clearly inside the camera view.</p>
            <div className="scanner-camera-actions">
              <button
                type="button"
                className="primary-button"
                disabled={cameraMode !== 'live'}
                onClick={capturePhoto}
              >
                <Camera size={16} />Capture photo
              </button>
              <button type="button" className="secondary-button" onClick={cancelCamera}>
                Cancel camera
              </button>
            </div>
          </div>
        )}

        {!previewUrl && cameraMode === 'idle' && status === 'idle' && (
          <div className="scanner-initial-state">
            <Camera size={30} aria-hidden="true" />
            <p>Use your camera or upload a photo of the printed medicine label.</p>
            <small>JPEG, PNG, WebP, or another browser-supported image up to 10 MB.</small>
          </div>
        )}

        {previewUrl && (
          <figure className="scanner-preview">
            <img src={previewUrl} alt="Preview of the selected printed medicine label" />
            <figcaption>{fileName}</figcaption>
          </figure>
        )}

        {previewUrl && cameraMode === 'captured' && (
          <div className="scanner-capture-review">
            <p>Review the captured label before text recognition begins.</p>
            <div className="scanner-camera-actions">
              <button type="button" className="secondary-button" onClick={() => void startCamera()}>
                <RotateCcw size={16} />Retake
              </button>
              <button type="button" className="primary-button" onClick={useCapturedPhoto}>
                <ScanText size={16} />Use photo
              </button>
            </div>
          </div>
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
