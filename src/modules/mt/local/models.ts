/**
 * The local translation model chosen by the Translation Benchmark Lab (docs/MT_ENGINE_MODEL_SELECTION.md).
 * Exact checkpoints are pinned by commit hash; the files are downloaded ON DEMAND after the user agrees (never bundled, never
 * downloaded silently). Licences: weights Apache-2.0 (model cards of Helsinki-NLP/opus-mt-en-vi and -vi-en).
 */
import type { LanguagePair } from '../types';

export interface LocalModelSpec {
  /** stable id used by the provider, the registry and the settings */
  id: string;
  label: string;
  /** Hugging Face repo that holds the ONNX export + tokenizer (Xenova conversion of the upstream checkpoint) */
  repo: string;
  /** commit hash of that repo (reproducible, no moving "main") */
  revision: string;
  /** the original checkpoint this was converted from */
  upstream: { repo: string; revision: string; license: string };
  dtype: 'q8' | 'fp32';
  pair: LanguagePair;
  /** bytes downloaded for this direction (measured by the benchmark lab) */
  downloadBytes: number;
  /** peak RAM measured while translating (dev machine, onnxruntime-node; WASM numbers differ and are measured in the e2e test) */
  peakRamBytes: number;
  /** the files that must be on the device, with the size and SHA-256 published by Hugging Face (LFS object ids); verified after download */
  files: { path: string; bytes: number; sha256: string }[];
  /** longest input the model takes in one call, in characters (512-token limit, conservative for Vietnamese) */
  maxChars: number;
}

export const LOCAL_MODEL_ID = 'local-opus-mt';

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: `${LOCAL_MODEL_ID}-en-vi`,
    label: 'OPUS-MT Anh → Việt (q8)',
    repo: 'Xenova/opus-mt-en-vi',
    revision: '30bcd461c0d7338ad106b36314d3eedc2d4e998c',
    upstream: { repo: 'Helsinki-NLP/opus-mt-en-vi', revision: '989c9fb9ec63987901022baf0182dcec3e149be6', license: 'apache-2.0' },
    dtype: 'q8',
    pair: { source: 'en', target: 'vi' },
    downloadBytes: 106_645_206,
    files: [
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 47_105_950, sha256: 'dfcd7a32be3fdd21cbcf5d354520d626f1768fd6e205ca62a6a11a4641d31f36' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 54_373_748, sha256: '1cfc6a84f9c189e6928c9710b281fae3f1f42d4ffbba109e7b4ec8e31ceb06dd' },
    ],
    peakRamBytes: 604 * 2 ** 20,
    maxChars: 900,
  },
  {
    id: `${LOCAL_MODEL_ID}-vi-en`,
    label: 'OPUS-MT Việt → Anh (q8)',
    repo: 'Xenova/opus-mt-vi-en',
    revision: '541dfd72ec07e8f1563795e0224408ad8d729e80',
    upstream: { repo: 'Helsinki-NLP/opus-mt-vi-en', revision: 'c8d2853e77f5fae31124d993e0b35176b1c8914e', license: 'apache-2.0' },
    dtype: 'q8',
    pair: { source: 'vi', target: 'en' },
    downloadBytes: 106_706_880,
    files: [
      { path: 'onnx/encoder_model_quantized.onnx', bytes: 47_133_597, sha256: 'fa7bd78e8bed6bdc03728f62f1592c4bb52d9e12795496604c1e990e102abdb2' },
      { path: 'onnx/decoder_model_merged_quantized.onnx', bytes: 54_401_611, sha256: '540edbcc08bab0b42c03576a759fd9b4d5fc99996ac3178630733916dc2325cb' },
    ],
    peakRamBytes: 592 * 2 ** 20,
    maxChars: 900,
  },
];

export const modelForPair = (p: LanguagePair): LocalModelSpec | undefined => LOCAL_MODELS.find((m) => m.pair.source === p.source && m.pair.target === p.target);
