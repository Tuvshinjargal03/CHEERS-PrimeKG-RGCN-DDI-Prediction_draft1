import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getJson } from '../lib/api.js'
import Experiments from './Experiments.jsx'

vi.mock('../lib/api.js', () => ({ getJson: vi.fn() }))

vi.mock('recharts', () => ({
  Bar: () => null,
  BarChart: ({ children }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  ErrorBar: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

const METRICS = {
  MRR: { mean: 0.5, std: 0.01 },
  'Hits@1': { mean: 0.4, std: 0.01 },
  'Hits@5': { mean: 0.6, std: 0.01 },
  'Hits@10': { mean: 0.7, std: 0.01 },
}

const RANKING = {
  summary: {
    final_results_mean_std: {
      G0: METRICS,
      G1: METRICS,
      G2: METRICS,
      G3: METRICS,
    },
    primary_result: {
      mean_MRR: 0.5,
      MRR_std: 0.01,
      absolute_MRR_improvement_vs_G0: 0.1,
      relative_MRR_improvement_percent: 25,
    },
  },
  reporting_note: 'Ranking reporting note.',
}

describe('Experiments networking', () => {
  beforeEach(() => {
    getJson.mockReset()
  })

  it('loads both datasets through getJson and keeps ranking visible if classification fails', async () => {
    getJson.mockImplementation((path) => (
      path === '/api/experiment'
        ? Promise.resolve(RANKING)
        : Promise.reject(new Error('Classification metrics are unavailable.'))
    ))

    render(
      <MemoryRouter>
        <Experiments />
      </MemoryRouter>,
    )

    expect(await screen.findByText('G3 provides the strongest overall performance')).toBeVisible()
    expect(screen.getByText(/Classification metrics are unavailable/)).toBeVisible()
    expect(screen.getByText(/Primary ranking results remain available/)).toBeVisible()

    await waitFor(() => {
      expect(getJson).toHaveBeenCalledTimes(2)
    })
    expect(getJson).toHaveBeenCalledWith('/api/experiment')
    expect(getJson).toHaveBeenCalledWith('/api/classification')
  })
})
