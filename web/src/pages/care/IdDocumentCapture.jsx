/**
 * ID document capture.
 *
 * No third-party identity vendor. The browser does the work: a camera frame or
 * an uploaded photo is centre-cropped to the CR80 card ratio, downscaled, and
 * posted as base64 JPEG. That keeps the document inside our own boundary,
 * which is the entire point of the control existing.
 *
 * The preview / retake loop is the safety net for bad shots. Drag-to-crop and
 * glare detection would be better, but shipping neither is a worse experience
 * than shipping a simple one, so this stops at retake and rotate.
 */

import { useEffect, useRef, useState } from 'react'

import { uploadIdDocument } from '../../lib/api.js'

const CARD_RATIO = 1.586 // CR80
const MAX_DIM = 1600

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that photo. Upload a JPEG or PNG.'))
    img.src = src
  })
}

/** Rotate a quarter turn, centre-crop to the card ratio, downscale, encode. */
function processImage(img, quarterTurns) {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!iw || !ih) throw new Error('Could not read that photo. Upload a JPEG or PNG.')

  const turns = ((quarterTurns % 4) + 4) % 4
  const rw = turns % 2 === 1 ? ih : iw
  const rh = turns % 2 === 1 ? iw : ih

  const rotated = document.createElement('canvas')
  rotated.width = rw
  rotated.height = rh
  const rctx = rotated.getContext('2d')
  rctx.translate(rw / 2, rh / 2)
  rctx.rotate((turns * Math.PI) / 2)
  rctx.drawImage(img, -iw / 2, -ih / 2)

  let cw = rw
  let ch = Math.round(rw / CARD_RATIO)
  if (ch > rh) {
    ch = rh
    cw = Math.round(rh * CARD_RATIO)
  }

  const scale = Math.min(1, MAX_DIM / cw, MAX_DIM / ch)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(cw * scale))
  out.height = Math.max(1, Math.round(ch * scale))
  out
    .getContext('2d')
    .drawImage(rotated, (rw - cw) / 2, (rh - ch) / 2, cw, ch, 0, 0, out.width, out.height)

  const dataUrl = out.toDataURL('image/jpeg', 0.85)
  return { dataUrl, base64: dataUrl.split(',')[1] }
}

export function IdDocumentCapture({ csrf, idType, savedLabel, disabled, onSaved }) {
  const [mode, setMode] = useState('idle') // idle | camera | preview | uploading | saved
  const [preview, setPreview] = useState(null)
  const [turns, setTurns] = useState(0)
  const [error, setError] = useState('')
  const [cameraBlocked, setCameraBlocked] = useState(false)
  const fileRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const sourceRef = useRef(null)
  const dialogRef = useRef(null)
  const restoreFocusRef = useRef(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => stopCamera, [])

  useEffect(() => {
    if (mode !== 'camera') return undefined
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => {
        if (cancelled) return
        setCameraBlocked(true)
        setError('The camera is unavailable here. Upload a photo of your ID instead.')
      })
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [mode])

  const toPreview = async (src, revokeAfterLoad = false) => {
    try {
      const img = await loadImage(src)
      sourceRef.current = img
      setTurns(0)
      setPreview(processImage(img, 0))
      setMode('preview')
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      if (revokeAfterLoad) URL.revokeObjectURL(src)
    }
  }

  const onFile = (event) => {
    const file = event.target.files?.[0]
    // Reset so re-picking the same file still fires a change event.
    event.target.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('Upload a JPEG or PNG photo of your ID.')
      return
    }
    toPreview(URL.createObjectURL(file), true)
  }

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) {
      setError('The camera is still starting. Give it a moment and try again.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    toPreview(canvas.toDataURL('image/jpeg', 0.9))
  }

  const rotate = () => {
    if (!sourceRef.current) return
    const next = turns + 1
    setTurns(next)
    setPreview(processImage(sourceRef.current, next))
  }

  const confirm = async () => {
    if (!preview || !idType) return
    setMode('uploading')
    setError('')
    try {
      const result = await uploadIdDocument({ idType, mime: 'image/jpeg', data: preview.base64 }, csrf)
      stopCamera()
      onSaved?.({ id: result.id, idType: result.idType })
      setMode('saved')
    } catch (failure) {
      setError(failure.message ?? 'That upload did not go through. Try again.')
      setMode('preview')
    }
  }

  const reset = () => {
    stopCamera()
    setPreview(null)
    setTurns(0)
    setError('')
    setMode('idle')
  }

  // A hand-rolled focus trap: this is a modal surface, and letting Tab walk out
  // of it into the intake form behind would strand a screen-reader user.
  useEffect(() => {
    if (mode !== 'camera') return undefined
    const dialog = dialogRef.current
    restoreFocusRef.current = document.activeElement

    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      )

    ;(focusable()[0] ?? dialog)?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        reset()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (!items.length) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const inside = dialog?.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus()
      restoreFocusRef.current = null
    }
  }, [mode])

  if (savedLabel && (mode === 'saved' || mode === 'idle')) {
    return (
      <div className="idc">
        <p className="field__hint">
          ID on file — {savedLabel} ✓
        </p>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMode('idle')} disabled={disabled}>
          Replace ID photo
        </button>
      </div>
    )
  }

  return (
    <div className="idc">
      {mode !== 'preview' && mode !== 'uploading' && (
        <div className="quiz__options">
          <button
            type="button"
            className="quiz__chip"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || !idType}
          >
            <span>Upload photo</span>
            <span className="quiz__mark" aria-hidden="true">
              ↗
            </span>
          </button>
          <button type="button" className="quiz__chip" onClick={() => setMode('camera')} disabled={disabled || !idType}>
            <span>Use camera</span>
            <span className="quiz__mark" aria-hidden="true">
              ↗
            </span>
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={onFile}
        aria-label="Upload a photo of your ID"
      />

      {!idType && <p className="field__hint">Choose your ID type first.</p>}

      {mode === 'camera' && (
        <div
          ref={dialogRef}
          className="idc__modal"
          role="dialog"
          aria-modal="true"
          aria-label="Photograph your ID"
          tabIndex={-1}
        >
          <div className="idc__viewfinder">
            <video ref={videoRef} playsInline muted autoPlay />
            <span className="idc__guide" aria-hidden="true" />
          </div>
          <p className="field__hint">
            Lay your ID flat, centre it in the frame, fill the guide, and avoid glare.
          </p>
          <div className="idc__actions">
            <button type="button" className="btn btn--ghost" onClick={reset}>
              Cancel
            </button>
            <button type="button" className="btn btn--forest" onClick={capture} disabled={cameraBlocked}>
              Capture
            </button>
          </div>
        </div>
      )}

      {(mode === 'preview' || mode === 'uploading') && preview && (
        <div className="idc__preview">
          <img src={preview.dataUrl} alt="Preview of the ID photo you are about to upload" />
          <div className="idc__actions">
            <button type="button" className="btn btn--quiet btn--sm" onClick={reset} disabled={mode === 'uploading'}>
              Retake
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={rotate} disabled={mode === 'uploading'}>
              Rotate
            </button>
            <button type="button" className="btn btn--forest" onClick={confirm} disabled={mode === 'uploading'}>
              {mode === 'uploading' ? 'Uploading…' : 'Use this photo'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
