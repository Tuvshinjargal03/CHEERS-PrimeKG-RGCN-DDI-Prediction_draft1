// Frozen, verified research outputs prepared for presentation in the Experiments UI.
// These values are not live model output and are not consumed by the DDI predictor.
export const robustnessResults = {
  evidenceLevels: {
    primary: 'PRIMARY · 5 SEEDS',
    exploratory: 'EXPLORATORY · SEED 44',
    robustness: 'ROBUSTNESS · 3 MODEL SEEDS',
  },
  primaryInternal: {
    scope: 'Internal PrimeKG link ranking on one fixed split',
    models: [
      {
        model: 'G0',
        MRR: 0.527284,
        MRRSD: 0.006373,
        Hits1: 0.480464,
        Hits1SD: 0.005801,
        Hits5: 0.572694,
        Hits5SD: 0.007746,
        Hits10: 0.609447,
        Hits10SD: 0.009457,
      },
      {
        model: 'G3',
        MRR: 0.534209,
        MRRSD: 0.006288,
        Hits1: 0.48629,
        Hits1SD: 0.005899,
        Hits5: 0.580468,
        Hits5SD: 0.007,
        Hits10: 0.618074,
        Hits10SD: 0.007312,
      },
    ],
    mrrDifference: 0.006925,
  },
  externalDdinter: {
    scope: 'DDInter external ranking diagnostic',
    models: [
      {
        model: 'G0',
        MRR: 0.0125437,
        Hits1: 0.0035027,
        Hits5: 0.0126973,
        Hits10: 0.0224213,
        meanRank: 1114.6,
        medianRank: 781,
      },
      {
        model: 'G3',
        MRR: 0.0120882,
        Hits1: 0.0034416,
        Hits5: 0.0122493,
        Hits10: 0.0213828,
        meanRank: 1113.3,
        medianRank: 776,
      },
      {
        model: 'Structural-only',
        MRR: 0.016503,
        Hits1: 0.0047857,
        Hits5: 0.0173404,
        Hits10: 0.0300886,
        meanRank: 990.8,
        medianRank: 596,
      },
      {
        model: 'Hybrid',
        MRR: 0.0124457,
        Hits1: 0.003574,
        Hits5: 0.0125853,
        Hits10: 0.0223297,
        meanRank: 1123.5,
        medianRank: 780,
      },
    ],
  },
  representationDiagnostic: [
    {
      model: 'Structural-only',
      internal: {
        MRR: 0.119554,
        Hits1: 0.075318,
        Hits5: 0.150766,
        Hits10: 0.193494,
      },
      externalMRR: 0.016503,
      summary: 'Lower internal performance · higher observed external MRR',
    },
    {
      model: 'Hybrid',
      internal: {
        MRR: 0.542543,
        Hits1: 0.496052,
        Hits5: 0.588187,
        Hits10: 0.625125,
      },
      externalMRR: 0.0124457,
      summary: 'Strong internal performance · no retained external advantage',
    },
  ],
  coldStart: {
    scope: 'DDI-edge cold-start with one fixed cold cohort',
    models: [
      { model: 'G0', MRR: 0.140603, MRRSD: 0.058159 },
      { model: 'G3', MRR: 0.010184, MRRSD: 0.007833 },
    ],
  },
  relationAnalysis: {
    relation: 'Target',
    meanDeltaMRR: 0.006766,
  },
}

