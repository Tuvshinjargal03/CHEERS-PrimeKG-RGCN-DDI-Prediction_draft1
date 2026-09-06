import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import MedicineLabelScanner from './MedicineLabelScanner.jsx'

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  fetch: vi.fn(),
  getUserMedia: vi.fn(),
  postJson: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({ postJson: mocks.postJson }))
vi.mock('tesseract.js', () => ({ createWorker: mocks.createWorker }))

const ASPIRIN_MATCH = {
  name: 'Aspirin',
  entity_id: 'DB00945',
  node_id: 101,
  match_type: 'possible_text_match',
}
const AMPICILLIN_MATCH = {
  name: 'Ampicillin',
  entity_id: 'DB00415',
  node_id: 102,
  match_type: 'possible_text_match',
}

function imageFile(name = 'label.png') {
  return new File(['image bytes'], name, { type: 'image/png' })
}

async function openScanner(user) {
  await user.click(screen.getByRole('button', { name: 'Scan medicine label' }))
  return screen.getByRole('dialog', { name: /Scan medicine label/ })
}

async function uploadFile(file) {
  const input = screen.getByLabelText(/Upload photo/i)
  fireEvent.change(input, { target: { files: [file] } })
}

function restoreProperty(target, property, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
  } else {
    delete target[property]
  }
}

function containsRawImagePayload(value, uploadedFile, seen = new Set()) {
  if (value === uploadedFile || value instanceof File || value instanceof Blob) return true
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true
  if (typeof value === 'string') {
    return /^data:image\//i.test(value) || value.includes('aW1hZ2UgYnl0ZXM=')
  }
  if (value instanceof FormData) {
    return [...value.values()].some((entry) => containsRawImagePayload(entry, uploadedFile, seen))
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false

  seen.add(value)
  return Object.values(value).some((entry) => containsRawImagePayload(entry, uploadedFile, seen))
}

describe('MedicineLabelScanner', () => {
  const originalDescriptors = {}

  beforeAll(() => {
    originalDescriptors.createObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    originalDescriptors.revokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    originalDescriptors.requestAnimationFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame')
    originalDescriptors.mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
    originalDescriptors.fetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:medicine-label'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback) => { callback(); return 1 },
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    })
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: mocks.fetch,
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  })

  afterAll(() => {
    vi.restoreAllMocks()
    restoreProperty(URL, 'createObjectURL', originalDescriptors.createObjectURL)
    restoreProperty(URL, 'revokeObjectURL', originalDescriptors.revokeObjectURL)
    restoreProperty(window, 'requestAnimationFrame', originalDescriptors.requestAnimationFrame)
    restoreProperty(navigator, 'mediaDevices', originalDescriptors.mediaDevices)
    restoreProperty(globalThis, 'fetch', originalDescriptors.fetch)
  })

  beforeEach(() => {
    mocks.createWorker.mockReset()
    mocks.fetch.mockReset()
    mocks.getUserMedia.mockReset()
    mocks.postJson.mockReset()
    mocks.recognize.mockReset()
    mocks.terminate.mockReset()
    mocks.recognize.mockResolvedValue({ data: { text: 'ASPIRIN 100 mg' } })
    mocks.terminate.mockResolvedValue()
    mocks.createWorker.mockResolvedValue({
      recognize: mocks.recognize,
      terminate: mocks.terminate,
    })
    mocks.fetch.mockRejectedValue(new Error('Unexpected direct fetch from MedicineLabelScanner'))
    mocks.postJson.mockResolvedValue({ matches: [] })
  })

  it('accepts an image, performs mocked OCR, and sends text only to matching', async () => {
    const user = userEvent.setup()
    render(<MedicineLabelScanner targetLabel="Query drug" onDrugSelect={vi.fn()} />)
    await openScanner(user)

    const uploadedFile = imageFile()
    await uploadFile(uploadedFile)

    expect(await screen.findByAltText('Preview of the selected printed medicine label')).toBeVisible()
    await user.click(screen.getByText('Detected text'))
    expect(await screen.findByDisplayValue('ASPIRIN 100 mg')).toBeVisible()
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledTimes(1))
    expect(mocks.createWorker).toHaveBeenCalledTimes(1)
    const [language, oem, ocrOptions] = mocks.createWorker.mock.calls[0]
    expect(language).toBe('eng')
    expect(oem).toBeUndefined()
    expect(ocrOptions).toEqual(expect.objectContaining({
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/core',
      langPath: '/tesseract/lang',
      logger: expect.any(Function),
    }))
    for (const assetPath of [ocrOptions.workerPath, ocrOptions.corePath, ocrOptions.langPath]) {
      expect(assetPath).not.toMatch(/^https?:\/\//i)
      expect(assetPath).not.toMatch(/cdn|jsdelivr|unpkg|projectnaptha/i)
    }
    for (const call of mocks.postJson.mock.calls) {
      expect(call).toHaveLength(2)
      const [url, payload] = call
      expect(url).toBe('/api/drugs/match-text')
      expect(payload).toEqual({ text: 'ASPIRIN 100 mg', limit: 10 })
      expect(containsRawImagePayload(payload, uploadedFile)).toBe(false)
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
    // These are component-boundary guards, not page-level integration assertions.
    expect(mocks.postJson).not.toHaveBeenCalledWith('/api/predict', expect.anything())
    expect(mocks.postJson).not.toHaveBeenCalledWith('/api/context/pair', expect.anything())
  })

  it('rejects non-image files without OCR or backend matching', async () => {
    const user = userEvent.setup()
    render(<MedicineLabelScanner targetLabel="Query drug" onDrugSelect={vi.fn()} />)
    await openScanner(user)

    await uploadFile(new File(['not an image'], 'notes.txt', { type: 'text/plain' }))

    expect(await screen.findByText(/Choose an image file/)).toBeVisible()
    expect(mocks.createWorker).not.toHaveBeenCalled()
    expect(mocks.postJson).not.toHaveBeenCalled()
  })

  it('preserves the 10 MB image-size limit', async () => {
    const user = userEvent.setup()
    render(<MedicineLabelScanner targetLabel="Query drug" onDrugSelect={vi.fn()} />)
    await openScanner(user)
    const oversized = imageFile('large.png')
    Object.defineProperty(oversized, 'size', { value: 10 * 1024 * 1024 + 1 })

    await uploadFile(oversized)

    expect(await screen.findByText(/larger than 10 MB/)).toBeVisible()
    expect(mocks.createWorker).not.toHaveBeenCalled()
    expect(mocks.postJson).not.toHaveBeenCalled()
  })

  it('allows reviewed OCR text to be rematched and requires manual candidate selection', async () => {
    const user = userEvent.setup()
    const onDrugSelect = vi.fn()
    mocks.postJson
      .mockResolvedValueOnce({ matches: [] })
      .mockResolvedValueOnce({ matches: [ASPIRIN_MATCH, AMPICILLIN_MATCH] })
    render(<MedicineLabelScanner targetLabel="Query drug" onDrugSelect={onDrugSelect} />)
    await openScanner(user)
    await uploadFile(imageFile())
    const textarea = await screen.findByRole('textbox', { name: 'Text read from the image' })
    await waitFor(() => expect(mocks.postJson).toHaveBeenCalledTimes(1))

    await user.click(screen.getByText('Detected text'))
    fireEvent.change(textarea, { target: { value: 'reviewed aspirin text' } })
    await user.click(screen.getByRole('button', { name: 'Match reviewed text' }))

    expect(await screen.findByRole('button', { name: /Select Aspirin/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Select Ampicillin/ })).toBeVisible()
    expect(mocks.postJson).toHaveBeenLastCalledWith('/api/drugs/match-text', {
      text: 'reviewed aspirin text',
      limit: 10,
    })
    expect(onDrugSelect).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Select Aspirin/ }))
    expect(onDrugSelect).toHaveBeenCalledWith({
      name: 'Aspirin',
      entity_id: 'DB00945',
      node_id: 101,
    })
  })

  it('requests a mocked camera and stops its media track when closed', async () => {
    const user = userEvent.setup()
    const stop = vi.fn()
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] })
    render(<MedicineLabelScanner targetLabel="Query drug" onDrugSelect={vi.fn()} />)
    await openScanner(user)

    await user.click(screen.getByRole('button', { name: 'Use camera' }))
    await waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    }))
    await user.click(screen.getByRole('button', { name: 'Close medicine label scanner' }))

    expect(stop).toHaveBeenCalledTimes(1)
  })
})
