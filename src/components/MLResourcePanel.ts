/**
 * MLResourcePanel — Browser ML model resource management.
 *
 * Shows status of loaded ONNX models (DistilBERT-SST2, MiniLM-L6-v2,
 * Flan-T5, BERT-NER), estimated memory usage, and provides
 * load/unload controls.
 */

import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { h, replaceChildren } from '@/utils/dom-utils';

/* ------------------------------------------------------------------ */
/*  Model registry                                                     */
/* ------------------------------------------------------------------ */

export interface MLModelEntry {
  id: string;
  name: string;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  memoryMb?: number;
  lastUsed?: string;
  errorMessage?: string;
}

const DEFAULT_MODELS: MLModelEntry[] = [
  { id: 'distilbert-sst2', name: 'DistilBERT-SST2', status: 'idle', memoryMb: 67 },
  { id: 'minilm-l6-v2', name: 'MiniLM-L6-v2', status: 'idle', memoryMb: 23 },
  { id: 'flan-t5-small', name: 'Flan-T5 Small', status: 'idle', memoryMb: 77 },
  { id: 'bert-ner', name: 'BERT-NER', status: 'idle', memoryMb: 110 },
];

let _models: MLModelEntry[] = [...DEFAULT_MODELS];
const _listeners = new Set<() => void>();

export function getMLModels(): readonly MLModelEntry[] {
  return _models;
}

export function updateMLModelStatus(id: string, update: Partial<MLModelEntry>): void {
  _models = _models.map((m) => (m.id === id ? { ...m, ...update } : m));
  for (const fn of _listeners) fn();
}

export function onMLModelsChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/* ------------------------------------------------------------------ */
/*  Panel component                                                    */
/* ------------------------------------------------------------------ */

export class MLResourcePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'ml-resources',
      title: t('panels.mlResources') || 'ML Models',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Browser ML model status — memory usage, load/unload controls.',
    });

    this.render();
    this.unsubscribe = onMLModelsChange(() => this.render());
    this.refreshTimer = setInterval(() => this.render(), 30_000);
  }

  public destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.unsubscribe?.();
  }

  private render = (): void => {
    const models = getMLModels();
    const loadedCount = models.filter((m) => m.status === 'loaded').length;
    this.setCount(loadedCount);

    if (models.length === 0) {
      this.showEmpty('No ML models registered.');
      return;
    }

    const totalMem = models
      .filter((m) => m.status === 'loaded')
      .reduce((sum, m) => sum + (m.memoryMb ?? 0), 0);

    const container = h('div', { className: 'ml-resources' });

    // Summary bar
    container.appendChild(
      h('div', { className: 'gov-section-title' },
        `${loadedCount}/${models.length} loaded · ~${totalMem}MB VRAM`,
      ),
    );

    // Model rows
    for (const model of models) {
      container.appendChild(this.buildModelRow(model));
    }

    replaceChildren(this.content, container);
  };

  private buildModelRow(model: MLModelEntry): HTMLElement {
    const statusLabel = model.status === 'error' ? 'Error' : model.status;
    const row = h('div', { className: 'ml-model-row' },
      h('span', { className: 'ml-model-name' }, model.name),
      h('span', { className: `ml-model-status ${model.status}` }, statusLabel),
      h('span', { className: 'ml-model-mem' },
        model.status === 'loaded' ? `~${model.memoryMb ?? '?'}MB` : '—',
      ),
    );

    // Action buttons
    const actions = h('div', { className: 'ml-model-actions' });
    if (model.status === 'idle' || model.status === 'error') {
      const loadBtn = h('button', {
        className: 'ml-model-btn',
        onClick: () => this.loadModel(model.id),
      }, 'Load');
      actions.appendChild(loadBtn);
    } else if (model.status === 'loaded') {
      const unloadBtn = h('button', {
        className: 'ml-model-btn',
        onClick: () => this.unloadModel(model.id),
      }, 'Unload');
      actions.appendChild(unloadBtn);
    }
    row.appendChild(actions);

    if (model.errorMessage) {
      row.setAttribute('title', model.errorMessage);
    }

    return row;
  }

  private loadModel(id: string): void {
    updateMLModelStatus(id, { status: 'loading' });
    // In production, this would trigger actual model loading via Web Worker
    // For now, simulate completion
    setTimeout(() => updateMLModelStatus(id, { status: 'loaded', lastUsed: new Date().toISOString() }), 500);
  }

  private unloadModel(id: string): void {
    updateMLModelStatus(id, { status: 'idle', lastUsed: undefined });
  }
}
